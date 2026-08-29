/**
 * The parsers refuse a buffer too short to hold the header they read.
 *
 * Defect, 2026-08-29: they did not. describeIpv4 handed three bytes produced a
 * complete Header whose summary read
 *
 *     "undefined.undefined.undefined.undefined to undefined..., TTL undefined"
 *
 * and the inspector rendered exactly that. Reading past the end of a typed
 * array is not an error in JavaScript, it is `undefined`, and `undefined`
 * flows through arithmetic as NaN and through templates as the word.
 *
 * This is the boundary of the whole project: every byte the simulation shows
 * arrives here. A frame can be short for ordinary reasons, a capture stopped
 * mid-write among them, and the answer to a short frame is to say so, not to
 * describe fields that were never there.
 */
import { describe, expect, it } from 'vitest';
import groundTruth from '../fixtures/ground-truth.json';
import { ETHERNET_HEADER_BYTES, describeEthernet } from '../src/core/protocols/ethernet';
import { IPV4_HEADER_BYTES, describeIpv4, ipv4ChecksumValid } from '../src/core/protocols/ipv4';
import { TCP_MIN_HEADER_BYTES, describeTcp } from '../src/core/protocols/tcp';
import { UDP_HEADER_BYTES, describeUdp } from '../src/core/protocols/udp';
import { describeDns } from '../src/core/protocols/dns';
import { LLC_SNAP_BYTES, WIFI_HEADER_BYTES, describeWifi } from '../src/core/protocols/wifi';

const DNS_HEADER_BYTES = 12;

const parsers = [
  ['ethernet', describeEthernet, ETHERNET_HEADER_BYTES],
  ['ipv4', describeIpv4, IPV4_HEADER_BYTES],
  ['tcp', describeTcp, TCP_MIN_HEADER_BYTES],
  ['udp', describeUdp, UDP_HEADER_BYTES],
  ['dns', describeDns, DNS_HEADER_BYTES],
  ['wifi', describeWifi, WIFI_HEADER_BYTES + LLC_SNAP_BYTES],
] as const;

describe.each(parsers)('%s', (name, describeFn, headerBytes) => {
  it('refuses an empty buffer instead of describing nothing as something', () => {
    expect(() => describeFn(new Uint8Array(0))).toThrow();
  });

  it('refuses a buffer one byte short of its own header', () => {
    expect(() => describeFn(new Uint8Array(headerBytes - 1))).toThrow();
  });

  it('says which protocol was short, and by how much', () => {
    let message = '';
    try {
      describeFn(new Uint8Array(1));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message.toLowerCase()).toContain(name);
    expect(message).toContain(String(headerBytes));
  });

  it('accepts a buffer of exactly the header size', () => {
    expect(() => describeFn(new Uint8Array(headerBytes))).not.toThrow();
  });

  it('counts from the offset it was given, not from the start of the buffer', () => {
    // The parsers are called with an offset into a whole frame. A buffer long
    // enough overall but short after the offset is still short.
    const buffer = new Uint8Array(headerBytes + 4);
    expect(() => describeFn(buffer, 5)).toThrow();
    expect(() => describeFn(buffer, 0)).not.toThrow();
  });
});

describe('the IPv4 checksum check', () => {
  // It returns a verdict rather than throwing, because a truncated frame
  // really does fail its checksum and every caller wants that answer.
  it('answers false on a buffer too short to hold a header', () => {
    expect(ipv4ChecksumValid(new Uint8Array(4), 0)).toBe(false);
    expect(ipv4ChecksumValid(new Uint8Array(IPV4_HEADER_BYTES + 2), 8)).toBe(false);
  });

  it('answers false when the header claims a length the buffer cannot hold', () => {
    // A version/IHL byte of 0x4f announces a 60 byte header. Trusting it on a
    // 20 byte buffer is how a parser reads someone else's memory in a language
    // that has any.
    const lying = new Uint8Array(IPV4_HEADER_BYTES);
    lying[0] = 0x4f;
    expect(ipv4ChecksumValid(lying, 0)).toBe(false);
  });

  it('answers false when the header claims a length below the minimum', () => {
    const tooSmall = new Uint8Array(IPV4_HEADER_BYTES);
    tooSmall[0] = 0x41;
    expect(ipv4ChecksumValid(tooSmall, 0)).toBe(false);
  });

  it('still validates every header of the real capture', () => {
    // The guards must refuse what is broken without refusing what is not.
    for (const frame of groundTruth.frames) {
      const bytes = Uint8Array.from(
        frame.hex.match(/../g)!.map((pair) => parseInt(pair, 16)),
      );
      expect(ipv4ChecksumValid(bytes, ETHERNET_HEADER_BYTES), `frame ${frame.index}`).toBe(true);
    }
  });
});

describe('nothing that survives the guard renders as undefined', () => {
  it.each(parsers)('%s describes a full-size buffer with no undefined anywhere', (_n, fn, size) => {
    const header = fn(new Uint8Array(size));
    const seen = JSON.stringify(header);
    expect(seen).not.toContain('undefined');
    expect(seen).not.toContain('NaN');
  });
});
