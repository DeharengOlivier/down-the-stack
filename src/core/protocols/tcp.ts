import type { Field, Header } from '../types';
import { ByteWriter, parseIpv4, readU16, readU32 } from '../bytes/writer';
import { checksumParts, ipv4PseudoHeader } from '../bytes/checksum';
import { IP_PROTO } from './ipv4';

export const TCP_MIN_HEADER_BYTES = 20;

export const TCP_FLAG = {
  FIN: 0x01,
  SYN: 0x02,
  RST: 0x04,
  PSH: 0x08,
  ACK: 0x10,
  URG: 0x20,
  ECE: 0x40,
  CWR: 0x80,
} as const;

export const TCP_OPT = {
  EOL: 0,
  NOP: 1,
  MSS: 2,
  WINDOW_SCALE: 3,
  SACK_PERMITTED: 4,
  SACK: 5,
  TIMESTAMPS: 8,
} as const;

/**
 * Options are modelled as an explicit ordered list, padding entries included.
 *
 * That is deliberate. A tidier model would emit alignment padding on its own,
 * but then reproducing a real capture byte for byte becomes impossible, because
 * the exact placement of the no-operation bytes is a choice each operating
 * system makes differently. Here the sender's choices are data, not policy.
 */
export type TcpOption =
  | { kind: typeof TCP_OPT.EOL }
  | { kind: typeof TCP_OPT.NOP }
  | { kind: typeof TCP_OPT.MSS; mss: number }
  | { kind: typeof TCP_OPT.WINDOW_SCALE; shift: number }
  | { kind: typeof TCP_OPT.SACK_PERMITTED }
  | { kind: typeof TCP_OPT.TIMESTAMPS; value: number; echo: number }
  | { kind: number; data: Uint8Array };

export interface TcpFields {
  srcPort: number;
  dstPort: number;
  srcIp: string;
  dstIp: string;
  seq: number;
  ack: number;
  flags: number;
  window: number;
  urgentPointer?: number;
  options?: TcpOption[];
}

function encodeOptions(options: TcpOption[]): Uint8Array {
  const w = new ByteWriter(40);
  for (const opt of options) {
    switch (opt.kind) {
      case TCP_OPT.EOL:
      case TCP_OPT.NOP:
        w.u8(opt.kind);
        break;
      case TCP_OPT.MSS:
        w.u8(2).u8(4).u16((opt as { mss: number }).mss);
        break;
      case TCP_OPT.WINDOW_SCALE:
        w.u8(3).u8(3).u8((opt as { shift: number }).shift);
        break;
      case TCP_OPT.SACK_PERMITTED:
        w.u8(4).u8(2);
        break;
      case TCP_OPT.TIMESTAMPS: {
        const o = opt as { value: number; echo: number };
        w.u8(8).u8(10).u32(o.value).u32(o.echo);
        break;
      }
      default: {
        const o = opt as { kind: number; data: Uint8Array };
        w.u8(o.kind).u8(o.data.length + 2).raw(o.data);
      }
    }
  }
  return w.bytes();
}

export function encodeTcp(f: TcpFields, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const options = encodeOptions(f.options ?? []);
  if (options.length % 4 !== 0) {
    throw new Error(`TCP options must be a whole number of 32-bit words, got ${options.length} bytes`);
  }
  const headerBytes = TCP_MIN_HEADER_BYTES + options.length;
  const w = new ByteWriter(headerBytes + payload.length);
  w.u16(f.srcPort).u16(f.dstPort);
  w.u32(f.seq >>> 0).u32(f.ack >>> 0);
  w.u8(((headerBytes / 4) << 4) | 0); // data offset in words, then reserved bits
  w.u8(f.flags);
  w.u16(f.window);
  const checksumAt = w.length;
  w.u16(0);
  w.u16(f.urgentPointer ?? 0);
  w.raw(options);
  w.raw(payload);
  const segment = w.bytes();
  w.patchU16(
    checksumAt,
    checksumParts([
      ipv4PseudoHeader(parseIpv4(f.srcIp), parseIpv4(f.dstIp), IP_PROTO.TCP, segment.length),
      segment,
    ]),
  );
  return w.bytes();
}

export function flagNames(flags: number): string[] {
  const names: string[] = [];
  for (const [name, bit] of Object.entries(TCP_FLAG)) if (flags & bit) names.push(name);
  return names;
}

function describeOptions(b: Uint8Array, start: number, end: number): Field[] {
  const fields: Field[] = [];
  let i = start;
  while (i < end) {
    const kind = b[i];
    const bitOffset = i * 8;
    if (kind === TCP_OPT.EOL) {
      fields.push({ key: 'tcp.opt.eol', label: 'End of option list', bitOffset, bitLength: 8, value: 0, display: 'end, the rest is padding' });
      i += 1;
      continue;
    }
    if (kind === TCP_OPT.NOP) {
      // Pure alignment filler. Present because several options must start on a
      // four-byte boundary and the sender pads rather than reorder them.
      fields.push({ key: 'tcp.opt.nop', label: 'No operation', bitOffset, bitLength: 8, value: 1, display: 'padding, one byte' });
      i += 1;
      continue;
    }
    const len = b[i + 1];
    if (!len || i + len > end) break;
    switch (kind) {
      case TCP_OPT.MSS: {
        const mss = readU16(b, i + 2);
        fields.push({ key: 'tcp.opt.mss', label: 'Maximum segment size', bitOffset, bitLength: len * 8, value: mss, display: `${mss} bytes of payload per segment` });
        break;
      }
      case TCP_OPT.WINDOW_SCALE: {
        const shift = b[i + 2];
        fields.push({ key: 'tcp.opt.window_scale', label: 'Window scale', bitOffset, bitLength: len * 8, value: shift, display: `shift ${shift}, so the window field is multiplied by ${2 ** shift}` });
        break;
      }
      case TCP_OPT.SACK_PERMITTED:
        fields.push({ key: 'tcp.opt.sack_permitted', label: 'Selective acknowledgement permitted', bitOffset, bitLength: len * 8, value: 1, display: 'this end can acknowledge holes' });
        break;
      case TCP_OPT.TIMESTAMPS: {
        const value = readU32(b, i + 2);
        const echo = readU32(b, i + 6);
        fields.push({ key: 'tcp.opt.timestamps', label: 'Timestamps', bitOffset, bitLength: len * 8, value, display: `value ${value}, echoing ${echo}` });
        break;
      }
      default:
        fields.push({ key: `tcp.opt.${kind}`, label: `Option ${kind}`, bitOffset, bitLength: len * 8, value: kind, display: `${len} bytes` });
    }
    i += len;
  }
  return fields;
}

export function describeTcp(bytes: Uint8Array, byteOffset = 0): Header {
  const b = bytes.subarray(byteOffset);
  const dataOffsetWords = b[12] >> 4;
  const headerBytes = dataOffsetWords * 4;
  const flags = b[13];
  const srcPort = readU16(b, 0);
  const dstPort = readU16(b, 2);
  const seq = readU32(b, 4);
  const window = readU16(b, 14);

  const flagChildren: Field[] = Object.entries(TCP_FLAG).map(([name, bit]) => ({
    key: `tcp.flag.${name.toLowerCase()}`,
    label: name,
    bitOffset: 104 + (7 - Math.log2(bit)),
    bitLength: 1,
    value: flags & bit ? 1 : 0,
    display: flags & bit ? 'set' : 'clear',
  }));

  const fields: Field[] = [
    { key: 'tcp.src_port', label: 'Source port', bitOffset: 0, bitLength: 16, value: srcPort, display: `${srcPort}` },
    { key: 'tcp.dst_port', label: 'Destination port', bitOffset: 16, bitLength: 16, value: dstPort, display: `${dstPort}${dstPort === 443 ? ' (HTTPS)' : ''}` },
    { key: 'tcp.seq', label: 'Sequence number', bitOffset: 32, bitLength: 32, value: seq, display: `${seq}` },
    { key: 'tcp.ack', label: 'Acknowledgement number', bitOffset: 64, bitLength: 32, value: readU32(b, 8), display: `${readU32(b, 8)}` },
    { key: 'tcp.data_offset', label: 'Data offset', bitOffset: 96, bitLength: 4, value: dataOffsetWords, display: `${dataOffsetWords} words = ${headerBytes} bytes` },
    { key: 'tcp.reserved', label: 'Reserved', bitOffset: 100, bitLength: 4, value: b[12] & 0x0f, display: 'must be zero' },
    { key: 'tcp.flags', label: 'Flags', bitOffset: 104, bitLength: 8, value: flags, display: flagNames(flags).join(', ') || 'none', children: flagChildren },
    {
      key: 'tcp.window',
      label: 'Window size',
      bitOffset: 112,
      bitLength: 16,
      value: window,
      // The receiver advertising how much more it is willing to accept. This
      // single number is the whole of TCP flow control.
      display: `${window} bytes the sender may still have in flight`,
    },
    { key: 'tcp.checksum', label: 'Checksum', bitOffset: 128, bitLength: 16, value: readU16(b, 16), display: `0x${readU16(b, 16).toString(16).padStart(4, '0')}` },
    { key: 'tcp.urgent', label: 'Urgent pointer', bitOffset: 144, bitLength: 16, value: readU16(b, 18), display: `${readU16(b, 18)}` },
    ...describeOptions(b, TCP_MIN_HEADER_BYTES, headerBytes),
  ];

  return {
    protocol: 'tcp',
    layer: 4,
    byteOffset,
    byteLength: headerBytes,
    summary: `port ${srcPort} to ${dstPort}, [${flagNames(flags).join(', ') || 'none'}], seq ${seq}`,
    fields,
  };
}
