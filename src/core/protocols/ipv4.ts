import type { Field, Header } from '../types';
import { ByteWriter, formatIpv4, parseIpv4, readU16, requireBytes } from '../bytes/writer';
import { internetChecksum } from '../bytes/checksum';

export const IP_PROTO = { ICMP: 1, TCP: 6, UDP: 17 } as const;

const PROTO_NAMES: Record<number, string> = { 1: 'ICMP', 6: 'TCP', 17: 'UDP' };

export interface Ipv4Fields {
  dscp?: number;
  ecn?: number;
  totalLength: number;
  identification: number;
  dontFragment?: boolean;
  moreFragments?: boolean;
  fragmentOffset?: number;
  ttl: number;
  protocol: number;
  src: string;
  dst: string;
}

export const IPV4_HEADER_BYTES = 20;

export function encodeIpv4(f: Ipv4Fields): Uint8Array {
  const w = new ByteWriter(IPV4_HEADER_BYTES);
  w.u8(0x45); // version 4, header length 5 words
  w.u8((((f.dscp ?? 0) & 0x3f) << 2) | ((f.ecn ?? 0) & 0x03));
  w.u16(f.totalLength);
  w.u16(f.identification);
  const flags = (f.dontFragment ? 0x4000 : 0) | (f.moreFragments ? 0x2000 : 0);
  w.u16(flags | (((f.fragmentOffset ?? 0) / 8) & 0x1fff));
  w.u8(f.ttl);
  w.u8(f.protocol);
  const checksumAt = w.length;
  w.u16(0); // placeholder, the checksum covers itself as zero
  w.raw(parseIpv4(f.src));
  w.raw(parseIpv4(f.dst));
  const header = w.bytes();
  w.patchU16(checksumAt, internetChecksum(header));
  return w.bytes();
}

export function describeIpv4(bytes: Uint8Array, byteOffset = 0): Header {
  requireBytes('ipv4', bytes, byteOffset, IPV4_HEADER_BYTES);
  const b = bytes.subarray(byteOffset);
  const ihl = b[0] & 0x0f;
  const totalLength = readU16(b, 2);
  const flagsAndFrag = readU16(b, 6);
  const protocol = b[9];
  const src = formatIpv4(b, 12);
  const dst = formatIpv4(b, 16);

  const fields: Field[] = [
    {
      key: 'ipv4.version',
      label: 'Version',
      bitOffset: 0,
      bitLength: 4,
      value: b[0] >> 4,
      display: `${b[0] >> 4}`,
    },
    {
      key: 'ipv4.ihl',
      label: 'Header length',
      bitOffset: 4,
      bitLength: 4,
      value: ihl,
      // Counted in 32-bit words, which is why the maximum IPv4 header is 60
      // bytes and not something rounder.
      display: `${ihl} words = ${ihl * 4} bytes`,
    },
    {
      key: 'ipv4.dscp',
      label: 'Differentiated services',
      bitOffset: 8,
      bitLength: 6,
      value: b[1] >> 2,
      display: `0x${(b[1] >> 2).toString(16)}`,
    },
    {
      key: 'ipv4.ecn',
      label: 'Explicit congestion notification',
      bitOffset: 14,
      bitLength: 2,
      value: b[1] & 0x03,
      display: ['not capable', 'ECT(1)', 'ECT(0)', 'congestion experienced'][b[1] & 0x03],
    },
    {
      key: 'ipv4.total_length',
      label: 'Total length',
      bitOffset: 16,
      bitLength: 16,
      value: totalLength,
      display: `${totalLength} bytes, header and payload together`,
    },
    {
      key: 'ipv4.id',
      label: 'Identification',
      bitOffset: 32,
      bitLength: 16,
      value: readU16(b, 4),
      display: `0x${readU16(b, 4).toString(16).padStart(4, '0')}`,
    },
    {
      key: 'ipv4.flags',
      label: 'Flags',
      bitOffset: 48,
      bitLength: 3,
      value: flagsAndFrag >> 13,
      display: flagsAndFrag & 0x4000 ? "don't fragment" : 'may fragment',
      children: [
        {
          key: 'ipv4.flags.df',
          label: "Don't fragment",
          bitOffset: 49,
          bitLength: 1,
          value: (flagsAndFrag >> 14) & 1,
          display: (flagsAndFrag >> 14) & 1 ? 'set' : 'clear',
        },
        {
          key: 'ipv4.flags.mf',
          label: 'More fragments',
          bitOffset: 50,
          bitLength: 1,
          value: (flagsAndFrag >> 13) & 1,
          display: (flagsAndFrag >> 13) & 1 ? 'set' : 'clear',
        },
      ],
    },
    {
      key: 'ipv4.frag_offset',
      label: 'Fragment offset',
      bitOffset: 51,
      bitLength: 13,
      value: (flagsAndFrag & 0x1fff) * 8,
      display: `${(flagsAndFrag & 0x1fff) * 8} bytes into the original datagram`,
    },
    {
      key: 'ipv4.ttl',
      label: 'Time to live',
      bitOffset: 64,
      bitLength: 8,
      value: b[8],
      // Named for time but counted in hops: every router that forwards the
      // packet subtracts one, and the packet dies at zero. It is what stops a
      // routing loop from filling the network forever.
      display: `${b[8]} hops remaining`,
    },
    {
      key: 'ipv4.protocol',
      label: 'Protocol',
      bitOffset: 72,
      bitLength: 8,
      value: protocol,
      display: `${protocol} (${PROTO_NAMES[protocol] ?? 'unknown'})`,
    },
    {
      key: 'ipv4.checksum',
      label: 'Header checksum',
      bitOffset: 80,
      bitLength: 16,
      value: readU16(b, 10),
      // Header only, never the payload, because every router rewrites the TTL
      // and would otherwise have to re-checksum the entire packet.
      display: `0x${readU16(b, 10).toString(16).padStart(4, '0')}`,
    },
    {
      key: 'ipv4.src',
      label: 'Source address',
      bitOffset: 96,
      bitLength: 32,
      value: src,
      display: src,
    },
    {
      key: 'ipv4.dst',
      label: 'Destination address',
      bitOffset: 128,
      bitLength: 32,
      value: dst,
      display: dst,
    },
  ];

  return {
    protocol: 'ipv4',
    layer: 3,
    byteOffset,
    byteLength: ihl * 4,
    summary: `${src} to ${dst}, ${PROTO_NAMES[protocol] ?? protocol}, TTL ${b[8]}`,
    fields,
  };
}

/** True when the header's own checksum validates, which is the receiver's test. */
export function ipv4ChecksumValid(bytes: Uint8Array, byteOffset = 0): boolean {
  // A buffer too short to hold the header cannot have a valid checksum, and
  // saying so is the answer. This function returns a verdict rather than
  // throwing, so a truncated frame is reported as failing its checksum, which
  // is exactly what it is.
  if (bytes.length - byteOffset < IPV4_HEADER_BYTES) return false;
  const ihl = (bytes[byteOffset] & 0x0f) * 4;
  if (ihl < IPV4_HEADER_BYTES || bytes.length - byteOffset < ihl) return false;
  return internetChecksum(bytes.subarray(byteOffset, byteOffset + ihl)) === 0;
}
