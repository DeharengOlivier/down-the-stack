import type { Field, Header } from '../types';
import { ByteWriter, formatMac, parseMac, readU16, requireBytes } from '../bytes/writer';
import { crc32 } from '../bytes/checksum';

/**
 * The 802.11 data frame, reconstructed rather than captured.
 *
 * This is the one place in the project where the bytes do not come from the
 * capture, and the reason is worth stating plainly. When a laptop is on Wi-Fi,
 * the operating system hands packet capture tools an Ethernet-shaped frame,
 * because the wireless driver has already stripped the radio framing away. To
 * see the real 802.11 frame you need monitor mode, a second radio, and usually
 * a different machine.
 *
 * So this frame is built from the same payload the capture proves was sent, and
 * the interface says it is a reconstruction. The alternative was to skip the
 * layer entirely, which would leave a hole exactly where the journey gets
 * interesting.
 *
 * It is also shown unprotected. On a real WPA2 or WPA3 network the payload
 * carries an eight byte CCMP header and an eight byte message integrity check,
 * and everything between them is encrypted between the laptop and the access
 * point. Inventing that ciphertext would mean inventing a key, so the
 * simulation names the omission instead of faking it.
 */

export const FRAME_TYPE = { MANAGEMENT: 0, CONTROL: 1, DATA: 2 } as const;
export const SUBTYPE_QOS_DATA = 8;

/** Header bytes for a QoS data frame with three addresses. */
export const WIFI_HEADER_BYTES = 26;
/** Logical link control and subnetwork access protocol, the EtherType carrier. */
export const LLC_SNAP_BYTES = 8;
export const FCS_BYTES = 4;

export interface WifiFields {
  /** Access point address, the receiver on the way up. */
  bssid: string;
  /** The station sending, our laptop. */
  source: string;
  /** Final Ethernet destination, the router beyond the access point. */
  destination: string;
  sequenceNumber: number;
  fragmentNumber?: number;
  /** Traffic class. Best effort is 0, voice is 6. */
  priority?: number;
  durationUs?: number;
  etherType: number;
}

export function encodeWifi(f: WifiFields, payload: Uint8Array): Uint8Array {
  const w = new ByteWriter(WIFI_HEADER_BYTES + LLC_SNAP_BYTES + payload.length + FCS_BYTES);
  // Frame control, first byte: version 0, type data, subtype QoS data.
  w.u8((SUBTYPE_QOS_DATA << 4) | (FRAME_TYPE.DATA << 2) | 0);
  // Second byte: to the distribution system, meaning uplink through the AP.
  w.u8(0x01);
  // Duration is little-endian, unlike everything above it. 802.11 is a
  // different committee's protocol and does not share the Internet's byte
  // order habits.
  const dur = f.durationUs ?? 0;
  w.u8(dur & 0xff).u8((dur >> 8) & 0xff);
  w.raw(parseMac(f.bssid)); // address 1, receiver
  w.raw(parseMac(f.source)); // address 2, transmitter
  w.raw(parseMac(f.destination)); // address 3, final destination
  const seq = ((f.sequenceNumber & 0x0fff) << 4) | (f.fragmentNumber ?? 0);
  w.u8(seq & 0xff).u8((seq >> 8) & 0xff);
  const qos = f.priority ?? 0;
  w.u8(qos & 0xff).u8(0);
  // LLC with SNAP. Three bytes of link control, three of organisation code,
  // then the EtherType, because 802.11 has no EtherType field of its own.
  w.u8(0xaa).u8(0xaa).u8(0x03).u8(0x00).u8(0x00).u8(0x00).u16(f.etherType);
  w.raw(payload);
  const withoutFcs = w.bytes();
  const fcs = crc32(withoutFcs);
  // The frame check sequence goes on the wire little-endian.
  w.u8(fcs & 0xff).u8((fcs >>> 8) & 0xff).u8((fcs >>> 16) & 0xff).u8((fcs >>> 24) & 0xff);
  return w.bytes();
}

export function describeWifi(bytes: Uint8Array, byteOffset = 0): Header {
  requireBytes('wifi', bytes, byteOffset, WIFI_HEADER_BYTES + LLC_SNAP_BYTES);
  const b = bytes.subarray(byteOffset);
  const type = (b[0] >> 2) & 0x03;
  const subtype = (b[0] >> 4) & 0x0f;
  const seq = b[22] | (b[23] << 8);

  const fields: Field[] = [
    {
      key: 'wifi.fc',
      label: 'Frame control',
      bitOffset: 0,
      bitLength: 16,
      value: readU16(b, 0),
      display: type === 2 && subtype === 8 ? 'QoS data, uplink' : `type ${type}, subtype ${subtype}`,
      children: [
        { key: 'wifi.fc.version', label: 'Protocol version', bitOffset: 6, bitLength: 2, value: b[0] & 0x03, display: `${b[0] & 0x03}` },
        { key: 'wifi.fc.type', label: 'Type', bitOffset: 4, bitLength: 2, value: type, display: ['management', 'control', 'data', 'extension'][type] },
        { key: 'wifi.fc.subtype', label: 'Subtype', bitOffset: 0, bitLength: 4, value: subtype, display: subtype === 8 ? 'QoS data' : `${subtype}` },
        { key: 'wifi.fc.tods', label: 'To the distribution system', bitOffset: 15, bitLength: 1, value: b[1] & 0x01, display: b[1] & 0x01 ? 'yes, going up through the access point' : 'no' },
        { key: 'wifi.fc.protected', label: 'Protected frame', bitOffset: 8, bitLength: 1, value: (b[1] >> 6) & 1, display: (b[1] >> 6) & 1 ? 'encrypted' : 'not encrypted in this reconstruction' },
      ],
    },
    {
      key: 'wifi.duration',
      label: 'Duration',
      bitOffset: 16,
      bitLength: 16,
      value: b[2] | (b[3] << 8),
      // Every other station hears this and stays silent for that long. Wi-Fi
      // has no collision detection, so it books the air in advance instead.
      display: `${b[2] | (b[3] << 8)} microseconds of reserved air time`,
    },
    { key: 'wifi.addr1', label: 'Address 1, receiver', bitOffset: 32, bitLength: 48, value: formatMac(b, 4), display: `${formatMac(b, 4)}, the access point` },
    { key: 'wifi.addr2', label: 'Address 2, transmitter', bitOffset: 80, bitLength: 48, value: formatMac(b, 10), display: `${formatMac(b, 10)}, this laptop` },
    { key: 'wifi.addr3', label: 'Address 3, destination', bitOffset: 128, bitLength: 48, value: formatMac(b, 16), display: `${formatMac(b, 16)}, where the frame goes after the access point` },
    { key: 'wifi.seq', label: 'Sequence control', bitOffset: 176, bitLength: 16, value: seq >> 4, display: `frame ${seq >> 4}, fragment ${seq & 0x0f}` },
    { key: 'wifi.qos', label: 'QoS control', bitOffset: 192, bitLength: 16, value: b[24], display: `traffic class ${b[24] & 0x07}${(b[24] & 0x07) === 0 ? ', best effort' : ''}` },
    { key: 'wifi.llc', label: 'LLC header', bitOffset: 208, bitLength: 24, value: 'aa aa 03', display: 'unnumbered information, SNAP follows' },
    { key: 'wifi.snap.oui', label: 'SNAP organisation code', bitOffset: 232, bitLength: 24, value: '00 00 00', display: 'the Ethernet encapsulation code' },
    {
      key: 'wifi.snap.ethertype',
      label: 'EtherType',
      bitOffset: 256,
      bitLength: 16,
      value: readU16(b, 32),
      // The whole point of SNAP: 802.11 has no EtherType field, so eight extra
      // bytes are spent carrying the two that say "IPv4 is inside".
      display: `0x${readU16(b, 32).toString(16).padStart(4, '0')}, carried in SNAP because 802.11 has no field for it`,
    },
  ];

  return {
    protocol: 'wifi',
    layer: 2,
    byteOffset,
    byteLength: WIFI_HEADER_BYTES + LLC_SNAP_BYTES,
    summary: `802.11 QoS data, ${formatMac(b, 10)} to ${formatMac(b, 16)} via ${formatMac(b, 4)}`,
    fields,
  };
}
