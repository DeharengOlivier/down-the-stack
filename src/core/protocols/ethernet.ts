import type { Field, Header } from '../types';
import { ByteWriter, formatMac, parseMac, readU16, requireBytes } from '../bytes/writer';

export const ETHERTYPE = { IPV4: 0x0800, ARP: 0x0806, IPV6: 0x86dd } as const;

const ETHERTYPE_NAMES: Record<number, string> = {
  0x0800: 'IPv4',
  0x0806: 'ARP',
  0x86dd: 'IPv6',
};

export interface EthernetFields {
  dst: string;
  src: string;
  etherType: number;
}

export const ETHERNET_HEADER_BYTES = 14;

export function encodeEthernet(f: EthernetFields): Uint8Array {
  return new ByteWriter(ETHERNET_HEADER_BYTES)
    .raw(parseMac(f.dst))
    .raw(parseMac(f.src))
    .u16(f.etherType)
    .bytes();
}

/**
 * A MAC address carries two flag bits in the very first byte that almost nobody
 * looks at, and they explain the stand-in addresses used in the fixture: the
 * locally administered bit says the address was assigned by software rather
 * than burned in by the manufacturer. Modern phones and laptops set it
 * deliberately, randomising their address so Wi-Fi networks cannot track them
 * between visits.
 */
function macFields(bytes: Uint8Array, offset: number, prefix: string, label: string): Field {
  const first = bytes[offset];
  return {
    key: `ethernet.${prefix}`,
    label,
    bitOffset: (offset % ETHERNET_HEADER_BYTES) * 8,
    bitLength: 48,
    value: formatMac(bytes, offset),
    display: formatMac(bytes, offset),
    children: [
      {
        key: 'ethernet.mac.multicast',
        label: 'Individual/group bit',
        bitOffset: (offset % ETHERNET_HEADER_BYTES) * 8 + 7,
        bitLength: 1,
        value: first & 0x01,
        display: first & 0x01 ? 'group (multicast or broadcast)' : 'individual',
      },
      {
        key: 'ethernet.mac.local',
        label: 'Universal/local bit',
        bitOffset: (offset % ETHERNET_HEADER_BYTES) * 8 + 6,
        bitLength: 1,
        value: (first >> 1) & 0x01,
        display: (first >> 1) & 0x01 ? 'locally administered' : 'burned in by the manufacturer',
      },
    ],
  };
}

export function describeEthernet(bytes: Uint8Array, byteOffset = 0): Header {
  requireBytes('ethernet', bytes, byteOffset, ETHERNET_HEADER_BYTES);
  const b = bytes.subarray(byteOffset);
  const etherType = readU16(b, 12);
  return {
    protocol: 'ethernet',
    layer: 2,
    byteOffset,
    byteLength: ETHERNET_HEADER_BYTES,
    summary: `${formatMac(b, 6)} to ${formatMac(b, 0)}, ${ETHERTYPE_NAMES[etherType] ?? `0x${etherType.toString(16)}`}`,
    fields: [
      macFields(b, 0, 'dst', 'Destination MAC'),
      macFields(b, 6, 'src', 'Source MAC'),
      {
        key: 'ethernet.ethertype',
        label: 'EtherType',
        bitOffset: 96,
        bitLength: 16,
        value: etherType,
        display: `0x${etherType.toString(16).padStart(4, '0')} (${ETHERTYPE_NAMES[etherType] ?? 'unknown'})`,
      },
    ],
  };
}
