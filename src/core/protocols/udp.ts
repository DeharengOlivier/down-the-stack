import type { Header } from '../types';
import { ByteWriter, parseIpv4, readU16, requireBytes } from '../bytes/writer';
import { checksumParts, ipv4PseudoHeader } from '../bytes/checksum';
import { IP_PROTO } from './ipv4';

export const UDP_HEADER_BYTES = 8;

export interface UdpFields {
  srcPort: number;
  dstPort: number;
  srcIp: string;
  dstIp: string;
}

export function encodeUdp(f: UdpFields, payload: Uint8Array): Uint8Array {
  const length = UDP_HEADER_BYTES + payload.length;
  const w = new ByteWriter(length);
  w.u16(f.srcPort).u16(f.dstPort).u16(length).u16(0).raw(payload);
  const datagram = w.bytes();
  const sum = checksumParts([
    ipv4PseudoHeader(parseIpv4(f.srcIp), parseIpv4(f.dstIp), IP_PROTO.UDP, length),
    datagram,
  ]);
  // A zero checksum means "not computed" in UDP over IPv4, so the all-ones
  // representation of zero is sent instead. One of the few places where the
  // two representations of zero in one's complement arithmetic matter.
  w.patchU16(6, sum === 0 ? 0xffff : sum);
  return w.bytes();
}

export function describeUdp(bytes: Uint8Array, byteOffset = 0): Header {
  requireBytes('udp', bytes, byteOffset, UDP_HEADER_BYTES);
  const b = bytes.subarray(byteOffset);
  const srcPort = readU16(b, 0);
  const dstPort = readU16(b, 2);
  const length = readU16(b, 4);
  return {
    protocol: 'udp',
    layer: 4,
    byteOffset,
    byteLength: UDP_HEADER_BYTES,
    summary: `port ${srcPort} to ${dstPort}, ${length - UDP_HEADER_BYTES} bytes of payload`,
    fields: [
      { key: 'udp.src_port', label: 'Source port', bitOffset: 0, bitLength: 16, value: srcPort, display: `${srcPort}` },
      { key: 'udp.dst_port', label: 'Destination port', bitOffset: 16, bitLength: 16, value: dstPort, display: `${dstPort}${dstPort === 53 ? ' (DNS)' : ''}` },
      { key: 'udp.length', label: 'Length', bitOffset: 32, bitLength: 16, value: length, display: `${length} bytes, header included` },
      { key: 'udp.checksum', label: 'Checksum', bitOffset: 48, bitLength: 16, value: readU16(b, 6), display: `0x${readU16(b, 6).toString(16).padStart(4, '0')}` },
    ],
  };
}
