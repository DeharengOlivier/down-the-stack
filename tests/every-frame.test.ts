/**
 * The claim, applied to all 22 frames instead of three.
 *
 * tests/byte-exact.test.ts hand-transcribes the fields of the first three
 * frames, which is the strongest possible check and does not scale: the README
 * says the encoders reproduce "the captured frames", and nineteen of them were
 * never asked to.
 *
 * So this file reads every field off the capture with a reader written for
 * this test alone. It walks the bytes at the offsets the RFCs specify and
 * shares no code whatsoever with the encoders it is checking: a mistake living
 * in both would otherwise cancel itself out and the test would pass while the
 * simulation lied.
 */
import { describe, expect, it } from 'vitest';
import groundTruth from '../fixtures/ground-truth.json';
import { encodeEthernet } from '../src/core/protocols/ethernet';
import { encodeIpv4 } from '../src/core/protocols/ipv4';
import { encodeUdp } from '../src/core/protocols/udp';
import { encodeTcp, type TcpOption } from '../src/core/protocols/tcp';

// --- the independent reader -------------------------------------------------

function bytesOf(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function hexOf(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

const u8 = (b: Uint8Array, o: number) => b[o]!;
const u16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32 = (b: Uint8Array, o: number) =>
  ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;

const macAt = (b: Uint8Array, o: number) =>
  Array.from(b.subarray(o, o + 6), (x) => x.toString(16).padStart(2, '0')).join(':');

const ipAt = (b: Uint8Array, o: number) => Array.from(b.subarray(o, o + 4)).join('.');

/** TCP options, walked by the length byte each one carries. */
function readTcpOptions(b: Uint8Array, start: number, end: number): TcpOption[] {
  const options: TcpOption[] = [];
  let at = start;
  while (at < end) {
    const kind = u8(b, at);
    // End-of-list and no-op are the two single-byte kinds: they carry no
    // length byte, so reading one would run off into the next option.
    if (kind === 0 || kind === 1) {
      options.push({ kind } as TcpOption);
      at += 1;
      continue;
    }
    const length = u8(b, at + 1);
    if (kind === 2) options.push({ kind: 2, mss: u16(b, at + 2) });
    else if (kind === 3) options.push({ kind: 3, shift: u8(b, at + 2) });
    else if (kind === 4) options.push({ kind: 4 });
    else if (kind === 8) options.push({ kind: 8, value: u32(b, at + 2), echo: u32(b, at + 6) });
    else options.push({ kind, data: b.slice(at + 2, at + length) });
    at += length;
  }
  return options;
}

const ETH = 14;
const IP = ETH + 20;

/** Rebuild one captured frame from the values read out of it. */
function reencode(frame: Uint8Array): Uint8Array {
  const totalLength = u16(frame, ETH + 2);
  const protocol = u8(frame, ETH + 9);
  const flags = u16(frame, ETH + 6);

  const eth = encodeEthernet({
    dst: macAt(frame, 0),
    src: macAt(frame, 6),
    etherType: u16(frame, 12),
  });
  const ip = encodeIpv4({
    dscp: u8(frame, ETH + 1) >> 2,
    ecn: u8(frame, ETH + 1) & 0x03,
    totalLength,
    identification: u16(frame, ETH + 4),
    dontFragment: (flags & 0x4000) !== 0,
    moreFragments: (flags & 0x2000) !== 0,
    fragmentOffset: (flags & 0x1fff) * 8,
    ttl: u8(frame, ETH + 8),
    protocol,
    src: ipAt(frame, ETH + 12),
    dst: ipAt(frame, ETH + 16),
  });

  const srcIp = ipAt(frame, ETH + 12);
  const dstIp = ipAt(frame, ETH + 16);
  // Where the IP payload ends, according to the IP header rather than the
  // frame: anything after that is Ethernet padding, not protocol data.
  const ipPayloadEnd = ETH + totalLength;

  if (protocol === 17) {
    const transport = encodeUdp(
      { srcPort: u16(frame, IP), dstPort: u16(frame, IP + 2), srcIp, dstIp },
      frame.slice(IP + 8, ipPayloadEnd),
    );
    return concat(eth, ip, transport);
  }

  const dataOffset = u8(frame, IP + 12) >> 4;
  const headerEnd = IP + dataOffset * 4;
  const transport = encodeTcp(
    {
      srcPort: u16(frame, IP),
      dstPort: u16(frame, IP + 2),
      srcIp,
      dstIp,
      seq: u32(frame, IP + 4),
      ack: u32(frame, IP + 8),
      flags: u8(frame, IP + 13),
      window: u16(frame, IP + 14),
      urgentPointer: u16(frame, IP + 18),
      options: readTcpOptions(frame, IP + 20, headerEnd),
    },
    frame.slice(headerEnd, ipPayloadEnd),
  );
  return concat(eth, ip, transport);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// --- the tests --------------------------------------------------------------

const frames = groundTruth.frames.map((frame) => ({ ...frame, bytes: bytesOf(frame.hex) }));

describe('every captured frame', () => {
  it.each(frames.map((f) => [f.index, f]))(
    'frame %i is rebuilt byte for byte from its own field values',
    (_index, frame) => {
      const rebuilt = reencode(frame.bytes);
      const carried = ETH + u16(frame.bytes, ETH + 2);
      expect(hexOf(rebuilt)).toBe(hexOf(frame.bytes.subarray(0, carried)));
    },
  );

  it('covers the whole capture, not a sample of it', () => {
    expect(frames.length).toBe(22);
    expect(frames.map((f) => f.index)).toEqual([...Array(22).keys()]);
  });

  it('carries both transports, so neither path is left unchecked', () => {
    const protocols = new Set(frames.map((f) => u8(f.bytes, ETH + 9)));
    expect(protocols).toEqual(new Set([6, 17]));
  });

  it('leaves only zero padding after the end of the IP packet', () => {
    // A frame shorter than 60 bytes is padded by the Ethernet layer. That
    // padding is not protocol data and must not carry anything.
    for (const frame of frames) {
      const carried = ETH + u16(frame.bytes, ETH + 2);
      const padding = frame.bytes.subarray(carried);
      expect(Array.from(padding), `frame ${frame.index}`).toEqual(
        Array.from(padding, () => 0),
      );
    }
  });
});
