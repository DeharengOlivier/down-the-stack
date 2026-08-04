/**
 * The 802.11a/g transmit chain, from bits to a waveform.
 *
 * This is where the journey stops being about naming things and starts being
 * about physics. Everything above this file moves bytes around. Here the bytes
 * become a voltage on an antenna.
 *
 * Modelled: 20 MHz OFDM, 64 subcarriers, 64-QAM at code rate 3/4, which is the
 * 54 Mbit/s mode. That is not the Wi-Fi generation a modern laptop negotiates.
 * It is the generation every later one extends rather than replaces, and it is
 * small enough that all 64 subcarriers fit on a screen at once. The interface
 * says which generation it is showing rather than implying it is Wi-Fi 6.
 */

// --- parameters of the 54 Mbit/s mode ---------------------------------------

export const FFT_SIZE = 64;
export const DATA_SUBCARRIERS = 48;
export const PILOT_SUBCARRIERS = 4;
/** Bits per subcarrier for 64-QAM. */
export const BITS_PER_SUBCARRIER = 6;
/** Coded bits per OFDM symbol: 48 data subcarriers times 6 bits. */
export const CODED_BITS_PER_SYMBOL = DATA_SUBCARRIERS * BITS_PER_SUBCARRIER;
/** Data bits per symbol at code rate 3/4. */
export const DATA_BITS_PER_SYMBOL = (CODED_BITS_PER_SYMBOL * 3) / 4;
export const SAMPLE_RATE_HZ = 20_000_000;
/** Samples of cyclic prefix, 0.8 microseconds at 20 MHz. */
export const GUARD_SAMPLES = 16;
export const SYMBOL_SAMPLES = FFT_SIZE + GUARD_SAMPLES;
export const SYMBOL_DURATION_NS = (SYMBOL_SAMPLES / SAMPLE_RATE_HZ) * 1e9; // 4000 ns

/** Subcarrier index of each pilot tone, in the -32..31 numbering. */
export const PILOT_INDICES = [-21, -7, 7, 21] as const;

/** The 48 data subcarrier indices, skipping DC, the pilots, and the guard band. */
export const DATA_INDICES: number[] = (() => {
  const out: number[] = [];
  for (let k = -26; k <= 26; k++) {
    if (k === 0) continue; // DC is left empty: a carrier at zero frequency
    if ((PILOT_INDICES as readonly number[]).includes(k)) continue;
    out.push(k);
  }
  return out;
})();

// --- 1. scrambler -----------------------------------------------------------

/**
 * A 7-bit shift register with polynomial x^7 + x^4 + 1, period 127.
 *
 * Its job is not secrecy. A long run of identical bits would put all the
 * transmitted energy on one subcarrier and give the receiver no transitions to
 * lock its clock onto. The scrambler guarantees the data looks random even when
 * it is a thousand zeroes.
 */
export function scramblerSequence(seed: number, length: number): Uint8Array {
  let state = seed & 0x7f;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const bit = ((state >> 6) ^ (state >> 3)) & 1;
    out[i] = bit;
    state = ((state << 1) | bit) & 0x7f;
  }
  return out;
}

export function scramble(bits: Uint8Array, seed = 0x5d): Uint8Array {
  const seq = scramblerSequence(seed, bits.length);
  const out = new Uint8Array(bits.length);
  for (let i = 0; i < bits.length; i++) out[i] = bits[i] ^ seq[i];
  return out;
}

/** Exclusive-or is its own inverse, so descrambling is the same operation. */
export const descramble = scramble;

// --- 2. convolutional code --------------------------------------------------

/** Generator polynomials 133 and 171 in octal, constraint length 7. */
export const G0 = 0o133;
export const G1 = 0o171;

function parity(v: number): number {
  v ^= v >> 4;
  v ^= v >> 2;
  v ^= v >> 1;
  return v & 1;
}

/**
 * Rate 1/2 encoder. Every input bit produces two output bits, each a parity
 * over the current bit and the six before it. Redundancy is added here, ahead
 * of any noise, because the receiver has no way to ask for a retransmission at
 * this layer.
 */
export function convolutionalEncode(bits: Uint8Array): Uint8Array {
  const out = new Uint8Array(bits.length * 2);
  let register = 0;
  for (let i = 0; i < bits.length; i++) {
    register = ((register >> 1) | (bits[i] << 6)) & 0x7f;
    out[i * 2] = parity(register & G0);
    out[i * 2 + 1] = parity(register & G1);
  }
  return out;
}

/**
 * Puncturing to rate 3/4: of every six coded bits, two are simply not
 * transmitted. The decoder marks the holes as unknown and the code is strong
 * enough to fill them back in. This is how one chain serves several data rates.
 */
export function puncture34(coded: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i + 5 < coded.length; i += 6) {
    out.push(coded[i], coded[i + 1], coded[i + 2], coded[i + 5]);
  }
  return Uint8Array.from(out);
}

/** Reinserts the punctured positions as erasures, marked 2. */
export function depuncture34(received: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i + 3 < received.length; i += 4) {
    out.push(received[i], received[i + 1], received[i + 2], 2, 2, received[i + 3]);
  }
  return Uint8Array.from(out);
}

/**
 * Viterbi decoder, 64 states, hard decision with erasures.
 *
 * It finds the single most likely path through every possible encoder history,
 * which is why a few flipped bits in the air do not become a corrupted packet.
 */
export function viterbiDecode(coded: Uint8Array, messageLength: number): Uint8Array {
  const STATES = 64;
  const steps = Math.floor(coded.length / 2);
  const INF = 1e9;

  // Precompute the two output bits for every state and input bit.
  const outA = new Uint8Array(STATES * 2);
  const outB = new Uint8Array(STATES * 2);
  const nextState = new Uint8Array(STATES * 2);
  for (let s = 0; s < STATES; s++) {
    for (let bit = 0; bit < 2; bit++) {
      // `s` holds the six previous bits with the newest at bit 5, so the full
      // register is the new bit at position 6 followed by those six.
      const reg = ((bit << 6) | s) & 0x7f;
      outA[s * 2 + bit] = parity(reg & G0);
      outB[s * 2 + bit] = parity(reg & G1);
      nextState[s * 2 + bit] = (reg >> 1) & 0x3f;
    }
  }

  let metrics = new Float64Array(STATES).fill(INF);
  metrics[0] = 0;
  const history = new Uint8Array(steps * STATES);

  for (let t = 0; t < steps; t++) {
    const a = coded[t * 2];
    const b = coded[t * 2 + 1];
    const next = new Float64Array(STATES).fill(INF);
    for (let s = 0; s < STATES; s++) {
      if (metrics[s] >= INF) continue;
      for (let bit = 0; bit < 2; bit++) {
        // An erasure, marked 2, costs nothing either way: it carries no
        // information rather than wrong information.
        const cost =
          (a === 2 ? 0 : a !== outA[s * 2 + bit] ? 1 : 0) +
          (b === 2 ? 0 : b !== outB[s * 2 + bit] ? 1 : 0);
        const ns = nextState[s * 2 + bit];
        const candidate = metrics[s] + cost;
        if (candidate < next[ns]) {
          next[ns] = candidate;
          history[t * STATES + ns] = (s << 1) | bit;
        }
      }
    }
    metrics = next;
  }

  // Trace back from the best final state.
  let best = 0;
  for (let s = 1; s < STATES; s++) if (metrics[s] < metrics[best]) best = s;

  const bits = new Uint8Array(steps);
  let state = best;
  for (let t = steps - 1; t >= 0; t--) {
    const entry = history[t * STATES + state];
    bits[t] = entry & 1;
    state = entry >> 1;
  }
  return bits.subarray(0, messageLength);
}

// --- 3. interleaver ---------------------------------------------------------

/**
 * Two permutations inside each symbol.
 *
 * The first spreads adjacent bits onto distant subcarriers, so that a notch in
 * the radio channel that wipes out one frequency damages scattered bits rather
 * than a run of them. The second makes sure consecutive bits do not all land on
 * the fragile low-order positions of the same constellation point. Scattered
 * single errors are what the convolutional code is good at fixing; bursts are
 * what it cannot.
 */
export function interleavePermutation(nCbps = CODED_BITS_PER_SYMBOL, nBpsc = BITS_PER_SUBCARRIER): Int32Array {
  const s = Math.max(nBpsc / 2, 1);
  const perm = new Int32Array(nCbps);
  for (let k = 0; k < nCbps; k++) {
    const i = (nCbps / 16) * (k % 16) + Math.floor(k / 16);
    const j = s * Math.floor(i / s) + ((i + nCbps - Math.floor((16 * i) / nCbps)) % s);
    perm[k] = j;
  }
  return perm;
}

export function interleave(bits: Uint8Array, perm = interleavePermutation()): Uint8Array {
  const out = new Uint8Array(bits.length);
  const n = perm.length;
  for (let block = 0; block * n < bits.length; block++) {
    for (let k = 0; k < n && block * n + k < bits.length; k++) {
      out[block * n + perm[k]] = bits[block * n + k];
    }
  }
  return out;
}

export function deinterleave(bits: Uint8Array, perm = interleavePermutation()): Uint8Array {
  const out = new Uint8Array(bits.length);
  const n = perm.length;
  for (let block = 0; block * n < bits.length; block++) {
    for (let k = 0; k < n && block * n + k < bits.length; k++) {
      out[block * n + k] = bits[block * n + perm[k]];
    }
  }
  return out;
}

// --- 4. constellation -------------------------------------------------------

export interface Complex {
  re: number;
  im: number;
}

/** Gray-coded amplitude for three bits, so neighbours differ by one bit. */
const GRAY_64: Record<string, number> = {
  '000': -7,
  '001': -5,
  '011': -3,
  '010': -1,
  '110': 1,
  '111': 3,
  '101': 5,
  '100': 7,
};

/** Keeps the average symbol power at one, so all rates are comparable. */
export const QAM64_NORMALISATION = 1 / Math.sqrt(42);

export function mapQam64(bits: Uint8Array): Complex[] {
  const out: Complex[] = [];
  for (let i = 0; i + 5 < bits.length; i += 6) {
    const iBits = `${bits[i]}${bits[i + 1]}${bits[i + 2]}`;
    const qBits = `${bits[i + 3]}${bits[i + 4]}${bits[i + 5]}`;
    out.push({
      re: GRAY_64[iBits]! * QAM64_NORMALISATION,
      im: GRAY_64[qBits]! * QAM64_NORMALISATION,
    });
  }
  return out;
}

function nearestGrayBits(value: number): [number, number, number] {
  let bestKey = '000';
  let bestDistance = Infinity;
  for (const [key, amplitude] of Object.entries(GRAY_64)) {
    const d = Math.abs(amplitude * QAM64_NORMALISATION - value);
    if (d < bestDistance) {
      bestDistance = d;
      bestKey = key;
    }
  }
  return [Number(bestKey[0]), Number(bestKey[1]), Number(bestKey[2])];
}

export function demapQam64(symbols: Complex[]): Uint8Array {
  const out = new Uint8Array(symbols.length * 6);
  symbols.forEach((s, i) => {
    const [a, b, c] = nearestGrayBits(s.re);
    const [d, e, f] = nearestGrayBits(s.im);
    out.set([a, b, c, d, e, f], i * 6);
  });
  return out;
}

// --- 5. subcarriers and the inverse transform -------------------------------

/** Pilot polarity, from the same shift register run with an all-ones seed. */
export function pilotPolarity(symbolIndex: number): number {
  const seq = scramblerSequence(0x7f, 127);
  return seq[symbolIndex % 127] ? -1 : 1;
}

/** Places 48 data symbols and 4 pilots into the 64-bin frequency domain. */
export function buildSpectrum(data: Complex[], symbolIndex: number): Complex[] {
  const spectrum: Complex[] = Array.from({ length: FFT_SIZE }, () => ({ re: 0, im: 0 }));
  const bin = (k: number) => (k + FFT_SIZE) % FFT_SIZE;
  DATA_INDICES.forEach((k, i) => {
    spectrum[bin(k)] = data[i] ?? { re: 0, im: 0 };
  });
  const polarity = pilotPolarity(symbolIndex);
  const pilotValues = [1, 1, 1, -1];
  PILOT_INDICES.forEach((k, i) => {
    spectrum[bin(k)] = { re: pilotValues[i] * polarity, im: 0 };
  });
  return spectrum;
}

function fft(input: Complex[], inverse: boolean): Complex[] {
  const n = input.length;
  if (n === 1) return [{ ...input[0] }];
  const even = fft(input.filter((_, i) => i % 2 === 0), inverse);
  const odd = fft(input.filter((_, i) => i % 2 === 1), inverse);
  const out: Complex[] = new Array(n);
  const sign = inverse ? 2 : -2;
  for (let k = 0; k < n / 2; k++) {
    const angle = (sign * Math.PI * k) / n;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    const tr = wr * odd[k].re - wi * odd[k].im;
    const ti = wr * odd[k].im + wi * odd[k].re;
    out[k] = { re: even[k].re + tr, im: even[k].im + ti };
    out[k + n / 2] = { re: even[k].re - tr, im: even[k].im - ti };
  }
  return out;
}

/** Frequency domain to time domain. */
export function inverseFft(spectrum: Complex[]): Complex[] {
  return fft(spectrum, true).map((c) => ({ re: c.re / spectrum.length, im: c.im / spectrum.length }));
}

export function forwardFft(samples: Complex[]): Complex[] {
  return fft(samples, false);
}

/**
 * Prepends the last 16 samples to the front of the symbol.
 *
 * This copy is the cyclic prefix, and it is the trick that makes OFDM work
 * indoors. Reflections off walls arrive late and smear into the start of each
 * symbol; the prefix is a sacrificial copy for them to land on, leaving the
 * real 64 samples clean.
 */
export function addCyclicPrefix(samples: Complex[]): Complex[] {
  return [...samples.slice(FFT_SIZE - GUARD_SAMPLES), ...samples];
}

export function removeCyclicPrefix(samples: Complex[]): Complex[] {
  return samples.slice(GUARD_SAMPLES);
}

// --- the whole chain --------------------------------------------------------

export interface OfdmSymbol {
  index: number;
  /** Bits after coding and interleaving, the ones this symbol carries. */
  codedBits: Uint8Array;
  constellation: Complex[];
  spectrum: Complex[];
  /** 80 complex samples: 16 of cyclic prefix then 64 of symbol. */
  samples: Complex[];
}

export interface OfdmResult {
  dataBits: Uint8Array;
  scrambled: Uint8Array;
  coded: Uint8Array;
  punctured: Uint8Array;
  symbols: OfdmSymbol[];
  durationNs: number;
}

export function bytesToBits(bytes: Uint8Array): Uint8Array {
  const bits = new Uint8Array(bytes.length * 8);
  for (let i = 0; i < bytes.length; i++) {
    // Least significant bit first, which is the order 802.11 puts on the wire.
    for (let b = 0; b < 8; b++) bits[i * 8 + b] = (bytes[i] >> b) & 1;
  }
  return bits;
}

export function bitsToBytes(bits: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 1 << (i & 7);
  return bytes;
}

/** Runs the full transmit chain over a frame's bytes. */
export function modulate(frame: Uint8Array, seed = 0x5d): OfdmResult {
  const dataBits = bytesToBits(frame);
  const scrambled = scramble(dataBits, seed);

  // Six zero tail bits return the encoder to a known state so the decoder can
  // trust the end of the trellis.
  const withTail = new Uint8Array(scrambled.length + 6);
  withTail.set(scrambled, 0);

  const coded = convolutionalEncode(withTail);
  let punctured = puncture34(coded);

  // Pad the final symbol out to a whole number of coded bits.
  const remainder = punctured.length % CODED_BITS_PER_SYMBOL;
  if (remainder !== 0) {
    const padded = new Uint8Array(punctured.length + (CODED_BITS_PER_SYMBOL - remainder));
    padded.set(punctured, 0);
    punctured = padded;
  }

  const perm = interleavePermutation();
  const symbols: OfdmSymbol[] = [];
  const count = punctured.length / CODED_BITS_PER_SYMBOL;
  for (let s = 0; s < count; s++) {
    const chunk = punctured.subarray(s * CODED_BITS_PER_SYMBOL, (s + 1) * CODED_BITS_PER_SYMBOL);
    const interleaved = interleave(chunk, perm);
    const constellation = mapQam64(interleaved);
    const spectrum = buildSpectrum(constellation, s);
    const samples = addCyclicPrefix(inverseFft(spectrum));
    symbols.push({ index: s, codedBits: interleaved, constellation, spectrum, samples });
  }

  return {
    dataBits,
    scrambled,
    coded,
    punctured,
    symbols,
    durationNs: symbols.length * SYMBOL_DURATION_NS,
  };
}

/** Runs the receive chain, which must give the transmitted bytes back. */
export function demodulate(result: OfdmResult, frameLength: number, seed = 0x5d): Uint8Array {
  const perm = interleavePermutation();
  const recovered: number[] = [];
  for (const symbol of result.symbols) {
    const spectrum = forwardFft(removeCyclicPrefix(symbol.samples));
    const bin = (k: number) => (k + FFT_SIZE) % FFT_SIZE;
    const data = DATA_INDICES.map((k) => spectrum[bin(k)]);
    const bits = demapQam64(data);
    recovered.push(...deinterleave(bits, perm));
  }
  const depunctured = depuncture34(Uint8Array.from(recovered));
  const decoded = viterbiDecode(depunctured, frameLength * 8);
  return bitsToBytes(descramble(decoded, seed));
}
