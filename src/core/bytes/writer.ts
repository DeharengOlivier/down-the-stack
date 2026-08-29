/**
 * A growable big-endian byte writer.
 *
 * Network byte order is big-endian everywhere in this project, so the methods
 * do not offer a choice: offering one would only create opportunities to get
 * it wrong.
 */
export class ByteWriter {
  private buf: Uint8Array;
  private len = 0;

  constructor(capacity = 256) {
    this.buf = new Uint8Array(capacity);
  }

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let cap = this.buf.length || 1;
    while (cap < this.len + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  get length(): number {
    return this.len;
  }

  u8(v: number): this {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
    return this;
  }

  u16(v: number): this {
    this.ensure(2);
    this.buf[this.len++] = (v >>> 8) & 0xff;
    this.buf[this.len++] = v & 0xff;
    return this;
  }

  u24(v: number): this {
    this.ensure(3);
    this.buf[this.len++] = (v >>> 16) & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
    this.buf[this.len++] = v & 0xff;
    return this;
  }

  u32(v: number): this {
    this.ensure(4);
    this.buf[this.len++] = (v >>> 24) & 0xff;
    this.buf[this.len++] = (v >>> 16) & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
    this.buf[this.len++] = v & 0xff;
    return this;
  }

  raw(src: ArrayLike<number>): this {
    this.ensure(src.length);
    this.buf.set(src as Uint8Array, this.len);
    this.len += src.length;
    return this;
  }

  ascii(s: string): this {
    this.ensure(s.length);
    for (let i = 0; i < s.length; i++) this.buf[this.len++] = s.charCodeAt(i) & 0xff;
    return this;
  }

  zeros(n: number): this {
    this.ensure(n);
    this.len += n;
    return this;
  }

  /** Overwrite two bytes already written, for checksums computed after the fact. */
  patchU16(offset: number, v: number): this {
    this.buf[offset] = (v >>> 8) & 0xff;
    this.buf[offset + 1] = v & 0xff;
    return this;
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

export function parseMac(mac: string): Uint8Array {
  const parts = mac.split(':');
  if (parts.length !== 6) throw new Error(`bad MAC: ${mac}`);
  return Uint8Array.from(parts, (p) => parseInt(p, 16));
}

export function formatMac(bytes: Uint8Array, offset = 0): string {
  const out: string[] = [];
  for (let i = 0; i < 6; i++) out.push(bytes[offset + i].toString(16).padStart(2, '0'));
  return out.join(':');
}

export function parseIpv4(ip: string): Uint8Array {
  const parts = ip.split('.');
  if (parts.length !== 4) throw new Error(`bad IPv4: ${ip}`);
  return Uint8Array.from(parts, (p) => Number(p) & 0xff);
}

export function formatIpv4(bytes: Uint8Array, offset = 0): string {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
}

export function readU16(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}

export function readU32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

export function toHex(b: Uint8Array, offset = 0, length = b.length - offset): string {
  let s = '';
  for (let i = 0; i < length; i++) s += b[offset + i].toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Refuses a buffer too short to hold the header about to be read from it.
 *
 * Reading past the end of a typed array is not an error in JavaScript, it is
 * `undefined`, which flows onwards as NaN through arithmetic and as the word
 * "undefined" through a template. A parser that does not check first does not
 * fail: it produces a complete, confident, wrong description.
 *
 * This is the boundary of the whole project. Every byte the simulation shows
 * comes through one of the describe functions, and a frame can be short for
 * ordinary reasons, a capture stopped mid-write among them. Past this check
 * the parsers index freely, which is the point of checking once.
 *
 * @param protocol Named in the message, so the caller learns which layer.
 * @param bytes The buffer being parsed.
 * @param byteOffset Where this header starts inside it.
 * @param needed Bytes the fixed part of the header occupies.
 * @throws RangeError when fewer than `needed` bytes remain after the offset.
 */
export function requireBytes(
  protocol: string,
  bytes: Uint8Array,
  byteOffset: number,
  needed: number,
): void {
  const available = bytes.length - byteOffset;
  if (available < needed) {
    throw new RangeError(
      `${protocol}: need ${needed} bytes at offset ${byteOffset}, only ${Math.max(0, available)} available`,
    );
  }
}
