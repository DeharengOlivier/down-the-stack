/**
 * The test that decides whether this project is honest.
 *
 * Every field value below was read off the real capture by hand. The encoders
 * are given those values and must produce the captured frame byte for byte. If
 * a checksum routine is wrong, if a field is a byte off, if an option is
 * mis-ordered, this fails.
 */
import { describe, expect, it } from 'vitest';
import groundTruth from '../fixtures/ground-truth.json';
import { fromHex, toHex } from '../src/core/bytes/writer';
import { encodeEthernet, ETHERTYPE } from '../src/core/protocols/ethernet';
import { encodeIpv4, IP_PROTO, ipv4ChecksumValid } from '../src/core/protocols/ipv4';
import { encodeUdp } from '../src/core/protocols/udp';
import { encodeTcp, TCP_FLAG, TCP_OPT } from '../src/core/protocols/tcp';
import { aRecordData, encodeDns } from '../src/core/protocols/dns';

const CLIENT_MAC = '02:1a:2b:3c:4d:5e';
const GATEWAY_MAC = '02:aa:bb:cc:dd:ee';
const CLIENT_IP = '192.168.1.100';
const RESOLVER_IP = '1.1.1.1';
const SERVER_IP = '172.66.147.243';

function captured(index: number): Uint8Array {
  const frame = groundTruth.frames[index];
  if (!frame) throw new Error(`no frame ${index} in the fixture`);
  return fromHex(frame.hex);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('frame 0, the DNS query', () => {
  it('is reproduced byte for byte', () => {
    const dns = encodeDns({
      id: 0xaa93,
      // Recursion desired, and the authentic-data bit that dig sets by default.
      flags: 0x0120,
      questions: [{ name: 'example.com', type: 1, class: 1 }],
    });
    const udp = encodeUdp(
      { srcPort: 0xe117, dstPort: 53, srcIp: CLIENT_IP, dstIp: RESOLVER_IP },
      dns,
    );
    const ip = encodeIpv4({
      totalLength: 20 + udp.length,
      identification: 0x3c6d,
      ttl: 64,
      protocol: IP_PROTO.UDP,
      src: CLIENT_IP,
      dst: RESOLVER_IP,
    });
    const eth = encodeEthernet({ dst: GATEWAY_MAC, src: CLIENT_MAC, etherType: ETHERTYPE.IPV4 });

    expect(toHex(concat(eth, ip, udp))).toBe(toHex(captured(0)));
  });
});

describe('frame 1, the DNS response', () => {
  it('is reproduced byte for byte, compression pointers included', () => {
    const dns = encodeDns({
      id: 0xaa93,
      flags: 0x81a0,
      questions: [{ name: 'example.com', type: 1, class: 1 }],
      answers: [
        // 0x0c is where the question name starts: twelve bytes in, right after
        // the fixed header. Both answers point at it rather than repeat it.
        { namePointer: 0x0c, type: 1, class: 1, ttl: 176, data: aRecordData('104.20.23.154') },
        { namePointer: 0x0c, type: 1, class: 1, ttl: 176, data: aRecordData('172.66.147.243') },
      ],
    });
    const udp = encodeUdp(
      { srcPort: 53, dstPort: 0xe117, srcIp: RESOLVER_IP, dstIp: CLIENT_IP },
      dns,
    );
    const ip = encodeIpv4({
      dscp: 0x18,
      totalLength: 20 + udp.length,
      identification: 0x336b,
      dontFragment: true,
      ttl: 56,
      protocol: IP_PROTO.UDP,
      src: RESOLVER_IP,
      dst: CLIENT_IP,
    });
    const eth = encodeEthernet({ dst: CLIENT_MAC, src: GATEWAY_MAC, etherType: ETHERTYPE.IPV4 });

    expect(toHex(concat(eth, ip, udp))).toBe(toHex(captured(1)));
  });
});

describe('frame 2, the TCP SYN that opens the connection', () => {
  it('is reproduced byte for byte, options and padding included', () => {
    const tcp = encodeTcp({
      srcPort: 0xc0b7,
      dstPort: 443,
      srcIp: CLIENT_IP,
      dstIp: SERVER_IP,
      seq: 0xb4f761c1,
      ack: 0,
      flags: TCP_FLAG.SYN | TCP_FLAG.ECE | TCP_FLAG.CWR,
      window: 0xffff,
      options: [
        { kind: TCP_OPT.MSS, mss: 1460 },
        { kind: TCP_OPT.NOP },
        { kind: TCP_OPT.WINDOW_SCALE, shift: 6 },
        { kind: TCP_OPT.NOP },
        { kind: TCP_OPT.NOP },
        { kind: TCP_OPT.TIMESTAMPS, value: 0x5532b1db, echo: 0 },
        { kind: TCP_OPT.SACK_PERMITTED },
        { kind: TCP_OPT.EOL },
        { kind: TCP_OPT.EOL },
      ],
    });
    const ip = encodeIpv4({
      totalLength: 20 + tcp.length,
      identification: 0,
      dontFragment: true,
      ttl: 64,
      protocol: IP_PROTO.TCP,
      src: CLIENT_IP,
      dst: SERVER_IP,
    });
    const eth = encodeEthernet({ dst: GATEWAY_MAC, src: CLIENT_MAC, etherType: ETHERTYPE.IPV4 });

    expect(toHex(concat(eth, ip, tcp))).toBe(toHex(captured(2)));
  });
});

describe('the captured headers validate on their own terms', () => {
  it('every IPv4 header in the fixture passes its own checksum', () => {
    for (const frame of groundTruth.frames) {
      const bytes = fromHex(frame.hex);
      expect(ipv4ChecksumValid(bytes, 14), `frame ${frame.index}`).toBe(true);
    }
  });
});
