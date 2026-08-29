import type { Field, Header } from '../types';
import { ByteWriter, formatIpv4, parseIpv4, readU16, readU32, requireBytes } from '../bytes/writer';

/** Transaction id, flags, and the four section counts. */
export const DNS_HEADER_BYTES = 12;

export const DNS_TYPE: Record<number, string> = { 1: 'A', 2: 'NS', 5: 'CNAME', 16: 'TXT', 28: 'AAAA' };
export const DNS_CLASS: Record<number, string> = { 1: 'IN' };

export interface DnsQuestion {
  name: string;
  type: number;
  class: number;
}

export interface DnsAnswer {
  /** Byte offset of the name this answer points at, for compressed names. */
  namePointer?: number;
  name?: string;
  type: number;
  class: number;
  ttl: number;
  data: Uint8Array;
}

export interface DnsFields {
  id: number;
  flags: number;
  questions: DnsQuestion[];
  answers?: DnsAnswer[];
}

export function encodeName(name: string): Uint8Array {
  const w = new ByteWriter(name.length + 2);
  for (const label of name.split('.')) {
    if (label.length === 0) continue;
    if (label.length > 63) throw new Error(`DNS label too long: ${label}`);
    w.u8(label.length).ascii(label);
  }
  w.u8(0); // the root label, the empty one every name ends with
  return w.bytes();
}

export function encodeDns(f: DnsFields): Uint8Array {
  const w = new ByteWriter(512);
  w.u16(f.id).u16(f.flags);
  w.u16(f.questions.length).u16(f.answers?.length ?? 0).u16(0).u16(0);
  for (const q of f.questions) w.raw(encodeName(q.name)).u16(q.type).u16(q.class);
  for (const a of f.answers ?? []) {
    if (a.namePointer !== undefined) {
      // The two high bits set mark a pointer, and the remaining fourteen give
      // an offset from the start of the message. This is why a DNS response
      // repeating a long name costs two bytes instead of the whole name again.
      w.u16(0xc000 | a.namePointer);
    } else {
      w.raw(encodeName(a.name ?? ''));
    }
    w.u16(a.type).u16(a.class).u32(a.ttl).u16(a.data.length).raw(a.data);
  }
  return w.bytes();
}

/** Reads a possibly compressed name, returning the text and the bytes consumed. */
export function readName(b: Uint8Array, offset: number): { name: string; length: number } {
  const labels: string[] = [];
  let i = offset;
  let consumed = 0;
  let jumped = false;
  let guard = 0;
  while (i < b.length && guard++ < 128) {
    const len = b[i];
    if (len === 0) {
      if (!jumped) consumed += 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      const pointer = ((len & 0x3f) << 8) | b[i + 1];
      if (!jumped) consumed += 2;
      jumped = true;
      i = pointer;
      continue;
    }
    labels.push(String.fromCharCode(...b.subarray(i + 1, i + 1 + len)));
    i += len + 1;
    if (!jumped) consumed += len + 1;
  }
  return { name: labels.join('.'), length: consumed };
}

export function describeDns(bytes: Uint8Array, byteOffset = 0): Header {
  requireBytes('dns', bytes, byteOffset, DNS_HEADER_BYTES);
  const b = bytes.subarray(byteOffset);
  const id = readU16(b, 0);
  const flags = readU16(b, 2);
  const qd = readU16(b, 4);
  const an = readU16(b, 6);
  const isResponse = (flags & 0x8000) !== 0;

  const fields: Field[] = [
    { key: 'dns.id', label: 'Transaction ID', bitOffset: 0, bitLength: 16, value: id, display: `0x${id.toString(16).padStart(4, '0')}, matches the reply to the question` },
    {
      key: 'dns.flags',
      label: 'Flags',
      bitOffset: 16,
      bitLength: 16,
      value: flags,
      display: isResponse ? 'response' : 'query',
      children: [
        { key: 'dns.flags.qr', label: 'Query or response', bitOffset: 16, bitLength: 1, value: isResponse ? 1 : 0, display: isResponse ? 'response' : 'query' },
        { key: 'dns.flags.opcode', label: 'Opcode', bitOffset: 17, bitLength: 4, value: (flags >> 11) & 0x0f, display: (flags >> 11) & 0x0f ? `${(flags >> 11) & 0x0f}` : 'standard query' },
        { key: 'dns.flags.aa', label: 'Authoritative answer', bitOffset: 21, bitLength: 1, value: (flags >> 10) & 1, display: (flags >> 10) & 1 ? 'yes' : 'no' },
        { key: 'dns.flags.tc', label: 'Truncated', bitOffset: 22, bitLength: 1, value: (flags >> 9) & 1, display: (flags >> 9) & 1 ? 'yes, retry over TCP' : 'no' },
        { key: 'dns.flags.rd', label: 'Recursion desired', bitOffset: 23, bitLength: 1, value: (flags >> 8) & 1, display: (flags >> 8) & 1 ? 'yes, do the whole lookup for me' : 'no' },
        { key: 'dns.flags.ra', label: 'Recursion available', bitOffset: 24, bitLength: 1, value: (flags >> 7) & 1, display: (flags >> 7) & 1 ? 'yes' : 'no' },
        { key: 'dns.flags.rcode', label: 'Response code', bitOffset: 28, bitLength: 4, value: flags & 0x0f, display: (flags & 0x0f) === 0 ? 'no error' : `error ${flags & 0x0f}` },
      ],
    },
    { key: 'dns.qdcount', label: 'Questions', bitOffset: 32, bitLength: 16, value: qd, display: `${qd}` },
    { key: 'dns.ancount', label: 'Answer records', bitOffset: 48, bitLength: 16, value: an, display: `${an}` },
    { key: 'dns.nscount', label: 'Authority records', bitOffset: 64, bitLength: 16, value: readU16(b, 8), display: `${readU16(b, 8)}` },
    { key: 'dns.arcount', label: 'Additional records', bitOffset: 80, bitLength: 16, value: readU16(b, 10), display: `${readU16(b, 10)}` },
  ];

  let cursor = 12;
  const names: string[] = [];
  for (let q = 0; q < qd; q++) {
    const { name, length } = readName(b, cursor);
    names.push(name);
    const type = readU16(b, cursor + length);
    fields.push({
      key: 'dns.qname',
      label: 'Question name',
      bitOffset: cursor * 8,
      bitLength: length * 8,
      value: name,
      display: `${name}, written as length-prefixed labels with no dots on the wire`,
    });
    fields.push({ key: 'dns.qtype', label: 'Question type', bitOffset: (cursor + length) * 8, bitLength: 16, value: type, display: DNS_TYPE[type] ?? `${type}` });
    fields.push({ key: 'dns.qclass', label: 'Question class', bitOffset: (cursor + length + 2) * 8, bitLength: 16, value: readU16(b, cursor + length + 2), display: DNS_CLASS[readU16(b, cursor + length + 2)] ?? '?' });
    cursor += length + 4;
  }

  const addresses: string[] = [];
  for (let a = 0; a < an; a++) {
    const { length } = readName(b, cursor);
    const type = readU16(b, cursor + length);
    const ttl = readU32(b, cursor + length + 4);
    const rdlength = readU16(b, cursor + length + 8);
    const rdataAt = cursor + length + 10;
    const value = type === 1 ? formatIpv4(b, rdataAt) : `${rdlength} bytes`;
    if (type === 1) addresses.push(value);
    fields.push({
      key: 'dns.answer',
      label: `Answer ${a + 1}`,
      bitOffset: cursor * 8,
      bitLength: (length + 10 + rdlength) * 8,
      value,
      display: `${DNS_TYPE[type] ?? type} ${value}, valid for ${ttl} seconds`,
    });
    cursor = rdataAt + rdlength;
  }

  return {
    protocol: 'dns',
    layer: 7,
    byteOffset,
    byteLength: cursor,
    summary: isResponse
      ? `response: ${names[0] ?? '?'} is ${addresses.join(', ') || 'no address'}`
      : `query: where is ${names[0] ?? '?'}`,
    fields,
  };
}

/** Convenience for building an A record's four bytes of data. */
export function aRecordData(ip: string): Uint8Array {
  return parseIpv4(ip);
}
