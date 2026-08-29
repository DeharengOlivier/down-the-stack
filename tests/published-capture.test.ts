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
    // 192.168.1.169. A private address identifies nothing outside the flat it
    // was captured in, which is why the capture can be published at all.
    expect(allBytes).toContain('c0a801a9');
    const host = groundTruth.serverIp.split('.').map(Number);
    expect(host[0]).not.toBe(10);
    expect(host.slice(0, 2)).not.toEqual([192, 168]);
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
