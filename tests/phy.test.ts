/**
 * The physical layer has no capture to check against, so it is held to two
 * other standards: structural facts taken from IEEE 802.11, and the fact that
 * the receive chain must give back exactly what the transmit chain was handed.
 * A single wrong permutation or a sign error breaks the round trip.
 */
import { describe, expect, it } from 'vitest';
import { crc32 as nodeCrc32 } from 'node:zlib';
import {
  CODED_BITS_PER_SYMBOL,
  DATA_BITS_PER_SYMBOL,
  DATA_INDICES,
  FFT_SIZE,
  GUARD_SAMPLES,
  PILOT_INDICES,
  SYMBOL_DURATION_NS,
  SYMBOL_SAMPLES,
  bitsToBytes,
  bytesToBits,
  buildSpectrum,
  convolutionalEncode,
  deinterleave,
  demapQam64,
  demodulate,
  depuncture34,
  descramble,
  forwardFft,
  interleave,
  inverseFft,
  mapQam64,
  modulate,
  puncture34,
  scramble,
  scramblerSequence,
  viterbiDecode,
} from '../src/core/phy/ofdm';
import { crc32, internetChecksum } from '../src/core/bytes/checksum';
import { loadSession } from '../src/core/scenario/capture';

function randomBits(n: number, seed = 12345): Uint8Array {
  // A tiny deterministic generator, so a failure is always reproducible.
  let state = seed;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (state >> 16) & 1;
  }
  return out;
}

describe('structure taken from the standard', () => {
  it('uses 48 data subcarriers, 4 pilots, and leaves DC empty', () => {
    expect(DATA_INDICES.length).toBe(48);
    expect(PILOT_INDICES.length).toBe(4);
    expect(DATA_INDICES).not.toContain(0);
    for (const pilot of PILOT_INDICES) expect(DATA_INDICES).not.toContain(pilot);
  });

  it('carries 288 coded bits and 216 data bits per symbol at 64-QAM rate 3/4', () => {
    expect(CODED_BITS_PER_SYMBOL).toBe(288);
    expect(DATA_BITS_PER_SYMBOL).toBe(216);
  });

  it('produces an 80 sample symbol lasting 4 microseconds', () => {
    expect(SYMBOL_SAMPLES).toBe(FFT_SIZE + GUARD_SAMPLES);
    expect(SYMBOL_SAMPLES).toBe(80);
    expect(SYMBOL_DURATION_NS).toBe(4000);
  });

  it('reaches 54 Mbit/s, which is what this mode is named after', () => {
    const bitsPerSecond = (DATA_BITS_PER_SYMBOL / (SYMBOL_DURATION_NS / 1e9)) / 1e6;
    expect(bitsPerSecond).toBe(54);
  });

  it('places pilots at the frequencies the standard names', () => {
    const spectrum = buildSpectrum(
      Array.from({ length: 48 }, () => ({ re: 0, im: 0 })),
      0,
    );
    for (const k of PILOT_INDICES) {
      const bin = (k + FFT_SIZE) % FFT_SIZE;
      expect(Math.abs(spectrum[bin].re)).toBe(1);
    }
    expect(spectrum[0].re).toBe(0); // DC stays empty
  });
});

describe('each stage is reversible on its own', () => {
  it('the scrambler repeats after 127 bits and undoes itself', () => {
    const seq = scramblerSequence(0x5d, 300);
    for (let i = 0; i < 300 - 127; i++) expect(seq[i]).toBe(seq[i + 127]);

    const bits = randomBits(500);
    expect(descramble(scramble(bits))).toEqual(bits);
  });

  it('the interleaver is a true permutation', () => {
    const bits = randomBits(CODED_BITS_PER_SYMBOL * 3);
    const woven = interleave(bits);
    expect(deinterleave(woven)).toEqual(bits);
    // A permutation moves bits around without creating or destroying any.
    const before = bits.reduce((n, b) => n + b, 0);
    expect(woven.reduce((n, b) => n + b, 0)).toBe(before);
  });

  it('64-QAM maps and demaps 6 bits per point', () => {
    const bits = randomBits(6 * 48);
    const points = mapQam64(bits);
    expect(points.length).toBe(48);
    expect(demapQam64(points)).toEqual(bits);
  });

  it('the inverse transform and the transform cancel out', () => {
    const spectrum = buildSpectrum(mapQam64(randomBits(288)), 0);
    const back = forwardFft(inverseFft(spectrum));
    spectrum.forEach((c, i) => {
      expect(back[i].re).toBeCloseTo(c.re, 10);
      expect(back[i].im).toBeCloseTo(c.im, 10);
    });
  });

  it('the convolutional code survives puncturing and Viterbi decoding', () => {
    const message = randomBits(200);
    const withTail = new Uint8Array(message.length + 6);
    withTail.set(message);
    const decoded = viterbiDecode(depuncture34(puncture34(convolutionalEncode(withTail))), message.length);
    expect(decoded).toEqual(message);
  });

  it('recovers the message even after bits are flipped in the air', () => {
    const message = randomBits(200, 999);
    const withTail = new Uint8Array(message.length + 6);
    withTail.set(message);
    const punctured = puncture34(convolutionalEncode(withTail));
    // Corrupt a handful of scattered bits, which is the error pattern the
    // interleaver exists to produce.
    for (const i of [7, 63, 130, 201]) punctured[i] ^= 1;
    const decoded = viterbiDecode(depuncture34(punctured), message.length);
    expect(decoded).toEqual(message);
  });

  it('bits and bytes convert back and forth, least significant bit first', () => {
    const bytes = Uint8Array.from([0x01, 0xff, 0xa5, 0x00, 0x80]);
    expect(bitsToBytes(bytesToBits(bytes))).toEqual(bytes);
    // 0x01 is a single set bit, and 802.11 sends it first.
    expect(bytesToBits(Uint8Array.from([0x01]))[0]).toBe(1);
  });
});

describe('the whole chain, on a real frame', () => {
  it('turns a captured frame into a waveform and reads it back unchanged', () => {
    const session = loadSession();
    // The DNS query: small enough to keep the test quick, real enough to matter.
    const frame = session.frames[0].bytes;
    const result = modulate(frame);

    expect(result.symbols.length).toBeGreaterThan(0);
    for (const symbol of result.symbols) {
      expect(symbol.samples.length).toBe(SYMBOL_SAMPLES);
      // The cyclic prefix really is a copy of the symbol's own tail.
      for (let i = 0; i < GUARD_SAMPLES; i++) {
        expect(symbol.samples[i].re).toBeCloseTo(symbol.samples[i + FFT_SIZE].re, 10);
      }
    }

    expect(demodulate(result, frame.length)).toEqual(frame);
  });

  it('spends the air time the standard predicts', () => {
    const session = loadSession();
    const frame = session.frames[0].bytes;
    const result = modulate(frame);
    const expectedSymbols = Math.ceil(((frame.length * 8 + 6) * 4) / 3 / CODED_BITS_PER_SYMBOL);
    expect(result.symbols.length).toBe(expectedSymbols);
    expect(result.durationNs).toBe(expectedSymbols * 4000);
  });
});

describe('the integrity functions agree with implementations we did not write', () => {
  it('matches Node on CRC-32', () => {
    for (const sample of ['123456789', 'down the stack', '']) {
      const bytes = new TextEncoder().encode(sample);
      expect(crc32(bytes)).toBe(nodeCrc32(Buffer.from(bytes)));
    }
    // The check value the CRC catalogue lists for CRC-32/ISO-HDLC.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('the Internet checksum of a buffer containing its own checksum is zero', () => {
    const session = loadSession();
    for (const frame of session.frames) {
      const header = frame.bytes.subarray(14, 14 + 20);
      expect(internetChecksum(header)).toBe(0);
    }
  });
});
