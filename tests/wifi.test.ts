/**
 * The 802.11 frame, which has no capture to be checked against.
 *
 * The README is explicit that this layer is reconstructed: a wireless driver
 * hands capture tools an Ethernet-shaped frame, so the radio framing was
 * already stripped before anything could record it. That makes byte-exactness
 * impossible here, and it makes the two remaining checks more important, not
 * less:
 *
 *   1. the structure has to match what IEEE 802.11 specifies, field by field,
 *      including the byte orders that differ from every layer above it;
 *   2. the encapsulation invariant has to hold: the payload handed in comes
 *      back out unchanged, because that is the single idea the whole project
 *      exists to teach.
 *
 * Anything the simulation is NOT modelling is asserted too, so that a later
 * change cannot quietly start claiming protection that is not there.
 */
import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/core/bytes/checksum';
import {
  FCS_BYTES,
  FRAME_TYPE,
  LLC_SNAP_BYTES,
  SUBTYPE_QOS_DATA,
  WIFI_HEADER_BYTES,
  describeWifi,
  encodeWifi,
} from '../src/core/protocols/wifi';
import { ETHERTYPE } from '../src/core/protocols/ethernet';

const AP = '02:aa:bb:cc:dd:ee';
const LAPTOP = '02:1a:2b:3c:4d:5e';
const ROUTER = '02:11:22:33:44:55';

const payload = () => Uint8Array.from({ length: 40 }, (_, i) => (i * 7) & 0xff);

function frame(overrides: Partial<Parameters<typeof encodeWifi>[0]> = {}, body = payload()) {
  return encodeWifi(
    {
      bssid: AP,
      source: LAPTOP,
      destination: ROUTER,
      sequenceNumber: 1234,
      durationUs: 44,
      etherType: ETHERTYPE.IPV4,
      ...overrides,
    },
    body,
  );
}

// --- structure --------------------------------------------------------------

describe('the frame the standard describes', () => {
  it('is header, LLC/SNAP, payload and trailer, and nothing else', () => {
    const body = payload();
    expect(frame({}, body).length).toBe(
      WIFI_HEADER_BYTES + LLC_SNAP_BYTES + body.length + FCS_BYTES,
    );
  });

  it('declares itself a QoS data frame going up through the access point', () => {
    const bytes = frame();
    expect((bytes[0]! >> 2) & 0x03).toBe(FRAME_TYPE.DATA);
    expect((bytes[0]! >> 4) & 0x0f).toBe(SUBTYPE_QOS_DATA);
    expect(bytes[0]! & 0x03).toBe(0); // protocol version 0, the only one there is
    expect(bytes[1]! & 0x01).toBe(1); // to the distribution system
    expect((bytes[1]! >> 1) & 0x01).toBe(0); // and not from it
  });

  it('puts the three addresses in the order 802.11 gives them', () => {
    // Receiver, then transmitter, then final destination. That order is not
    // the Ethernet one, and getting it wrong is invisible until a frame is
    // read by something real.
    const header = describeWifi(frame());
    const addresses = header.fields.filter((f) => f.key.startsWith('wifi.addr'));
    expect(addresses.map((f) => f.value)).toEqual([AP, LAPTOP, ROUTER]);
  });

  it('writes duration, sequence and the trailer little-endian', () => {
    // 802.11 came from a different committee and does not share the Internet's
    // byte order. Everything above this layer is big-endian; these are not.
    const bytes = frame({ durationUs: 0x1234, sequenceNumber: 0x0abc, fragmentNumber: 3 });
    expect([bytes[2], bytes[3]]).toEqual([0x34, 0x12]);

    const sequenceControl = (0x0abc << 4) | 3;
    expect([bytes[22], bytes[23]]).toEqual([sequenceControl & 0xff, (sequenceControl >> 8) & 0xff]);

    const withoutFcs = bytes.subarray(0, bytes.length - FCS_BYTES);
    const fcs = crc32(withoutFcs);
    expect(Array.from(bytes.subarray(-FCS_BYTES))).toEqual([
      fcs & 0xff,
      (fcs >>> 8) & 0xff,
      (fcs >>> 16) & 0xff,
      (fcs >>> 24) & 0xff,
    ]);
  });

  it('spends eight bytes on LLC and SNAP to carry a two byte EtherType', () => {
    // 802.11 has no EtherType field, which is the reason those eight bytes
    // exist at all.
    const bytes = frame();
    expect(Array.from(bytes.subarray(26, 32))).toEqual([0xaa, 0xaa, 0x03, 0x00, 0x00, 0x00]);
    expect((bytes[32]! << 8) | bytes[33]!).toBe(ETHERTYPE.IPV4);
  });

  it('carries the traffic class it was given', () => {
    expect(frame({ priority: 6 })[24]! & 0x07).toBe(6);
    expect(frame()[24]! & 0x07).toBe(0);
  });
});

// --- the invariant the project exists to teach ------------------------------

describe('encapsulation', () => {
  it('hands the payload back byte for byte, wrapped and unchanged', () => {
    const body = payload();
    const bytes = frame({}, body);
    const start = WIFI_HEADER_BYTES + LLC_SNAP_BYTES;
    expect(Array.from(bytes.subarray(start, start + body.length))).toEqual(Array.from(body));
  });

  it('leaves the payload alone whatever the header around it says', () => {
    const body = payload();
    const start = WIFI_HEADER_BYTES + LLC_SNAP_BYTES;
    const a = frame({ sequenceNumber: 1, durationUs: 0 }, body);
    const b = frame({ sequenceNumber: 4095, durationUs: 65535, priority: 7 }, body);
    expect(Array.from(a.subarray(start, start + body.length))).toEqual(
      Array.from(b.subarray(start, start + body.length)),
    );
  });

  it('wraps an empty payload without producing a malformed frame', () => {
    const bytes = frame({}, new Uint8Array(0));
    expect(bytes.length).toBe(WIFI_HEADER_BYTES + LLC_SNAP_BYTES + FCS_BYTES);
    expect(crc32(bytes.subarray(0, bytes.length - FCS_BYTES)) >>> 0).toBe(
      (bytes[bytes.length - 1]! << 24 >>> 0) +
        (bytes[bytes.length - 2]! << 16) +
        (bytes[bytes.length - 3]! << 8) +
        bytes[bytes.length - 4]!,
    );
  });
});

// --- what is deliberately not modelled --------------------------------------

describe('what this reconstruction does not claim', () => {
  it('never marks the frame protected, because no key was invented', () => {
    // On a real WPA network this bit is set and the payload is encrypted. The
    // simulation names the omission rather than faking the ciphertext, and the
    // interface says so: this pins it so a later change cannot start claiming
    // protection that is not there.
    const bytes = frame();
    expect((bytes[1]! >> 6) & 0x01).toBe(0);
    const header = describeWifi(bytes);
    const control = header.fields.find((f) => f.key === 'wifi.fc')!;
    const protectedBit = control.children!.find((f) => f.key === 'wifi.fc.protected')!;
    expect(protectedBit.display).toContain('not encrypted');
  });

  it('reports a header length that stops before the payload', () => {
    const header = describeWifi(frame());
    expect(header.byteLength).toBe(WIFI_HEADER_BYTES + LLC_SNAP_BYTES);
    expect(header.layer).toBe(2);
  });

  it('describes the frame it was actually handed, not a fixed example', () => {
    const header = describeWifi(frame({ sequenceNumber: 77 }));
    const sequence = header.fields.find((f) => f.key === 'wifi.seq')!;
    expect(sequence.value).toBe(77);
    expect(header.summary).toContain(LAPTOP);
    expect(header.summary).toContain(AP);
  });
});
