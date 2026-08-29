import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import groundTruth from '../fixtures/ground-truth.json';

/**
 * What ships in `fixtures/` is a real capture of a real network, so the
 * anonymisation that made it publishable is a mechanism like any other: it is
 * only worth something if something checks it. These tests are the check.
 *
 * They run against the published files, not against the script that produced
 * them, because the question is what is in the repository today.
 */

const frames = groundTruth.frames;
const allBytes = frames.map((frame) => frame.hex).join('');

/** The two MAC addresses of an Ethernet frame: destination, then source. */
function macsOf(hex: string): string[] {
  return [hex.slice(0, 12), hex.slice(12, 24)];
}

describe('the published capture', () => {
  it('carries frames at all, so the checks below have something to look at', () => {
    expect(frames.length).toBeGreaterThan(20);
  });

  it('holds no real hardware address', () => {
    // Bit 1 of the first byte is the locally administered bit. A real
    // manufacturer-assigned address never has it set, so any address here
    // without it would be somebody's actual network card.
    const globallyUnique = frames
      .flatMap((frame) => macsOf(frame.hex))
      .filter((mac) => (parseInt(mac.slice(0, 2), 16) & 0x02) === 0);
    expect([...new Set(globallyUnique)]).toEqual([]);
  });

  it('uses only the stand-in addresses the extraction script assigns', () => {
    // The laptop and the access point. The script has a third stand-in for
    // any other device that shows up; this capture never saw one.
    const macs = [...new Set(frames.flatMap((frame) => macsOf(frame.hex)))].sort();
    expect(macs).toEqual(['021a2b3c4d5e', '02aabbccddee']);
  });

  it('shows a client behind NAT rather than a public address', () => {
    // 192.168.1.100, the stand-in the extraction assigns. A private address
    // identifies nothing outside the flat it was captured in, and this one is
    // not even the address that was really there.
    expect(allBytes).toContain('c0a80164');
    const host = groundTruth.serverIp.split('.').map(Number);
    expect(host[0]).not.toBe(10);
    expect(host.slice(0, 2)).not.toEqual([192, 168]);
  });

  it('carries no private address other than the stand-in', () => {
    // Anything else would be a machine on somebody's real network that the
    // extraction failed to rewrite.
    const addresses = new Set();
    for (const frame of frames) {
      const bytes = Buffer.from(frame.hex, 'hex');
      if (bytes.readUInt16BE(12) !== 0x0800) continue;
      const ip = bytes.subarray(14);
      for (const at of [12, 16]) {
        const address = [ip[at], ip[at + 1], ip[at + 2], ip[at + 3]];
        const private_ =
          address[0] === 10 ||
          (address[0] === 172 && address[1] >= 16 && address[1] <= 31) ||
          (address[0] === 192 && address[1] === 168) ||
          (address[0] === 169 && address[1] === 254);
        if (private_) addresses.add(address.join('.'));
      }
    }
    expect([...addresses]).toEqual(['192.168.1.100']);
  });

  it('says how long things took without saying when they happened', () => {
    // The wall clock a capture was taken on says when somebody was at their
    // desk. The intervals are the part that carries meaning.
    expect(frames[0].tNs).toBe(0);
    expect(frames[frames.length - 1].tNs).toBeGreaterThan(0);
  });
});

describe('the published pcap itself', () => {
  // libpcap layout: a 24 byte global header, then per record a 16 byte header
  // (seconds, fraction, captured length, original length) and the frame.
  const pcap = readFileSync(new URL('../fixtures/ground-truth.pcap', import.meta.url));

  function recordSeconds(): number[] {
    const seconds: number[] = [];
    let offset = 24;
    while (offset + 16 <= pcap.length) {
      seconds.push(pcap.readUInt32LE(offset));
      offset += 16 + pcap.readUInt32LE(offset + 8);
    }
    return seconds;
  }

  it('is a classic libpcap file of Ethernet frames', () => {
    expect(pcap.readUInt32LE(0)).toBe(0xa1b2c3d4);
    expect(pcap.readUInt32LE(20)).toBe(1);
  });

  it('carries no wall clock of its own', () => {
    // The frames keep their intervals, which is the part that means anything.
    // The instant they are pinned to is the neutral one the extraction picks,
    // not the evening somebody happened to be at their desk.
    const seconds = recordSeconds();
    expect(seconds).toHaveLength(frames.length);
    expect(seconds[0]).toBe(1767225600); // 2026-01-01T00:00:00Z
    expect(Math.max(...seconds) - seconds[0]).toBeLessThan(60);
  });
});

describe('the TLS secrets that ship with it', () => {
  const keylog = readFileSync(new URL('../fixtures/session.keylog', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');

  it('is a key log, in the format the tooling writes', () => {
    expect(keylog).toHaveLength(5);
    for (const line of keylog) {
      expect(line).toMatch(/^[A-Z_0-9]+ [0-9a-f]{64} [0-9a-f]+$/);
    }
  });

  it('holds the secrets of one single session', () => {
    // Every line of a key log names the session it belongs to by the client
    // random. More than one value here would mean an unrelated session's
    // traffic had been made readable along with this one.
    const randoms = new Set(keylog.map((line) => line.split(' ')[1]));
    expect(randoms.size).toBe(1);
  });

  it('holds the secrets of the session that ships, and no other', () => {
    const [random] = keylog.map((line) => line.split(' ')[1]);
    // The client random is sent in clear in the ClientHello, so it must be
    // findable in the captured bytes themselves.
    expect(allBytes).toContain(random);
  });

  it('holds no long-term key material', () => {
    // Traffic secrets expose this one session and nothing else. A private key
    // would expose every session ever recorded against that certificate.
    const text = keylog.join('\n');
    expect(text).not.toContain('PRIVATE KEY');
    expect(text).not.toContain('RSA Session-ID');
  });
});
