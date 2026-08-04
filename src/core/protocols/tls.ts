import type { Field, Header } from '../types';
import { readU16, toHex } from '../bytes/writer';

/**
 * TLS 1.3: parsed from the capture, and genuinely decrypted.
 *
 * The handshake is not re-encoded from scratch. Reproducing one byte for byte
 * would mean replaying a specific client's private key material and its exact
 * extension ordering, which teaches nothing about encapsulation and would cost
 * more than the rest of the project. What is real here instead:
 *
 *   - the records and handshake messages are parsed out of the captured bytes,
 *   - the traffic keys are derived from the captured secrets with the real
 *     HKDF-Expand-Label construction of RFC 8446,
 *   - the decryption is an actual AES-GCM operation.
 *
 * So the moment where a wall of ciphertext turns into a readable GET request is
 * not an animation. It is a decryption, happening as you watch.
 */

export const CONTENT_TYPE: Record<number, string> = {
  20: 'change cipher spec',
  21: 'alert',
  22: 'handshake',
  23: 'application data',
};

export const HANDSHAKE_TYPE: Record<number, string> = {
  1: 'ClientHello',
  2: 'ServerHello',
  4: 'NewSessionTicket',
  8: 'EncryptedExtensions',
  11: 'Certificate',
  15: 'CertificateVerify',
  20: 'Finished',
};

export const CIPHER_SUITES: Record<number, string> = {
  0x1301: 'TLS_AES_128_GCM_SHA256',
  0x1302: 'TLS_AES_256_GCM_SHA384',
  0x1303: 'TLS_CHACHA20_POLY1305_SHA256',
};

const EXTENSION_NAMES: Record<number, string> = {
  0: 'server_name',
  10: 'supported_groups',
  13: 'signature_algorithms',
  16: 'application_layer_protocol_negotiation',
  43: 'supported_versions',
  45: 'psk_key_exchange_modes',
  51: 'key_share',
};

export interface TlsRecord {
  /** Offset of the record header inside the reassembled stream. */
  offset: number;
  contentType: number;
  legacyVersion: number;
  length: number;
  /** The record body, still encrypted for content type 23. */
  payload: Uint8Array;
}

/** Splits a reassembled TCP stream into TLS records. */
export function parseRecords(stream: Uint8Array): TlsRecord[] {
  const records: TlsRecord[] = [];
  let i = 0;
  while (i + 5 <= stream.length) {
    const length = readU16(stream, i + 3);
    if (i + 5 + length > stream.length) break;
    records.push({
      offset: i,
      contentType: stream[i],
      legacyVersion: readU16(stream, i + 1),
      length,
      payload: stream.subarray(i + 5, i + 5 + length),
    });
    i += 5 + length;
  }
  return records;
}

export function describeRecord(record: TlsRecord): Header {
  return {
    protocol: 'tls',
    layer: 5,
    byteOffset: record.offset,
    byteLength: 5,
    summary: `${CONTENT_TYPE[record.contentType] ?? record.contentType}, ${record.length} bytes`,
    fields: [
      {
        key: 'tls.record.type',
        label: 'Content type',
        bitOffset: 0,
        bitLength: 8,
        value: record.contentType,
        // Encrypted records always claim to be application data, whatever they
        // really contain. The true type is the last byte of the plaintext, so
        // an observer cannot tell a handshake message from a page request.
        display: `${record.contentType} (${CONTENT_TYPE[record.contentType] ?? 'unknown'})`,
      },
      {
        key: 'tls.record.version',
        label: 'Legacy version',
        bitOffset: 8,
        bitLength: 16,
        value: record.legacyVersion,
        // Frozen at 1.2 forever. Middleboxes on the Internet drop records that
        // announce anything newer, so TLS 1.3 lies here and negotiates the real
        // version inside an extension.
        display: `0x${record.legacyVersion.toString(16).padStart(4, '0')}, always says 1.2 to get past middleboxes`,
      },
      { key: 'tls.record.length', label: 'Length', bitOffset: 24, bitLength: 16, value: record.length, display: `${record.length} bytes` },
    ],
  };
}

export interface HandshakeMessage {
  offset: number;
  type: number;
  length: number;
  body: Uint8Array;
}

export function parseHandshake(payload: Uint8Array, baseOffset = 0): HandshakeMessage[] {
  const out: HandshakeMessage[] = [];
  let i = 0;
  while (i + 4 <= payload.length) {
    const type = payload[i];
    const length = (payload[i + 1] << 16) | (payload[i + 2] << 8) | payload[i + 3];
    if (i + 4 + length > payload.length) break;
    out.push({ offset: baseOffset + i, type, length, body: payload.subarray(i + 4, i + 4 + length) });
    i += 4 + length;
  }
  return out;
}

const textDecoder = new TextDecoder();

/** Pulls the interesting parts out of a ClientHello or ServerHello. */
export function describeHello(msg: HandshakeMessage): Header {
  const b = msg.body;
  const fields: Field[] = [];
  let i = 0;

  fields.push({ key: 'tls.hello.version', label: 'Legacy version', bitOffset: 0, bitLength: 16, value: readU16(b, 0), display: '0x0303, again pretending to be 1.2' });
  i += 2;

  fields.push({
    key: 'tls.hello.random',
    label: 'Random',
    bitOffset: i * 8,
    bitLength: 256,
    value: toHex(b, i, 32),
    display: `32 bytes of randomness, ${toHex(b, i, 8)}...`,
  });
  i += 32;

  const sessionIdLen = b[i];
  fields.push({
    key: 'tls.hello.session_id',
    label: 'Legacy session ID',
    bitOffset: i * 8,
    bitLength: (sessionIdLen + 1) * 8,
    value: sessionIdLen,
    display: `${sessionIdLen} bytes, kept only so the exchange looks like TLS 1.2 on the wire`,
  });
  i += 1 + sessionIdLen;

  const isClient = msg.type === 1;
  if (isClient) {
    const suitesLen = readU16(b, i);
    const suites: string[] = [];
    for (let s = 0; s < suitesLen; s += 2) {
      const id = readU16(b, i + 2 + s);
      suites.push(CIPHER_SUITES[id] ?? `0x${id.toString(16)}`);
    }
    fields.push({
      key: 'tls.hello.cipher_suites',
      label: 'Cipher suites offered',
      bitOffset: i * 8,
      bitLength: (suitesLen + 2) * 8,
      value: suites.length,
      display: `${suites.length} offered: ${suites.slice(0, 4).join(', ')}${suites.length > 4 ? '...' : ''}`,
    });
    i += 2 + suitesLen;
    const compLen = b[i];
    i += 1 + compLen;
  } else {
    const id = readU16(b, i);
    fields.push({
      key: 'tls.hello.cipher_suite',
      label: 'Cipher suite chosen',
      bitOffset: i * 8,
      bitLength: 16,
      value: id,
      display: CIPHER_SUITES[id] ?? `0x${id.toString(16)}`,
    });
    i += 2;
    i += 1; // legacy compression method
  }

  if (i + 2 <= b.length) {
    const extLen = readU16(b, i);
    const extEnd = i + 2 + extLen;
    let e = i + 2;
    while (e + 4 <= extEnd) {
      const extType = readU16(b, e);
      const extDataLen = readU16(b, e + 2);
      const data = b.subarray(e + 4, e + 4 + extDataLen);
      let display = `${extDataLen} bytes`;
      if (extType === 0 && data.length > 5) {
        display = textDecoder.decode(data.subarray(5));
      } else if (extType === 43) {
        display = isClient ? 'offers TLS 1.3' : 'TLS 1.3 selected, here rather than in the version field';
      } else if (extType === 16 && data.length > 3) {
        display = textDecoder.decode(data.subarray(3));
      } else if (extType === 51) {
        display = 'a Diffie-Hellman public key, sent before the server has even replied';
      }
      fields.push({
        key: `tls.ext.${EXTENSION_NAMES[extType] ?? extType}`,
        label: EXTENSION_NAMES[extType] ?? `Extension ${extType}`,
        bitOffset: e * 8,
        bitLength: (extDataLen + 4) * 8,
        value: extType,
        display,
      });
      e += 4 + extDataLen;
    }
  }

  return {
    protocol: 'tls',
    layer: 5,
    byteOffset: msg.offset,
    byteLength: msg.length + 4,
    summary: HANDSHAKE_TYPE[msg.type] ?? `handshake ${msg.type}`,
    fields,
  };
}

// --- real cryptography ------------------------------------------------------

export interface KeylogSecrets {
  clientHandshake?: Uint8Array;
  serverHandshake?: Uint8Array;
  clientApplication?: Uint8Array;
  serverApplication?: Uint8Array;
}

/** Reads the NSS key log format that every TLS stack can emit. */
export function parseKeylog(text: string): KeylogSecrets {
  const out: KeylogSecrets = {};
  for (const line of text.split('\n')) {
    const [label, , secretHex] = line.trim().split(/\s+/);
    if (!label || !secretHex) continue;
    const secret = Uint8Array.from(secretHex.match(/../g) ?? [], (h) => parseInt(h, 16));
    if (label === 'CLIENT_HANDSHAKE_TRAFFIC_SECRET') out.clientHandshake = secret;
    else if (label === 'SERVER_HANDSHAKE_TRAFFIC_SECRET') out.serverHandshake = secret;
    else if (label === 'CLIENT_TRAFFIC_SECRET_0') out.clientApplication = secret;
    else if (label === 'SERVER_TRAFFIC_SECRET_0') out.serverApplication = secret;
  }
  return out;
}

const encoder = new TextEncoder();

async function hmac(hash: string, key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource));
}

/** HKDF-Expand of RFC 5869, the expand half only. */
async function hkdfExpand(hash: string, prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const hashLen = hash === 'SHA-384' ? 48 : 32;
  const n = Math.ceil(length / hashLen);
  const out = new Uint8Array(n * hashLen);
  let previous: Uint8Array = new Uint8Array(0);
  for (let i = 1; i <= n; i++) {
    const input = new Uint8Array(previous.length + info.length + 1);
    input.set(previous, 0);
    input.set(info, previous.length);
    input[input.length - 1] = i;
    previous = await hmac(hash, prk, input);
    out.set(previous, (i - 1) * hashLen);
  }
  return out.subarray(0, length);
}

/**
 * HKDF-Expand-Label of RFC 8446.
 *
 * The "tls13 " prefix on every label is domain separation: it guarantees that a
 * key derived here can never collide with a key derived by some other protocol
 * that happens to use HKDF with the same secret.
 */
export async function hkdfExpandLabel(
  hash: string,
  secret: Uint8Array,
  label: string,
  context: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const fullLabel = encoder.encode(`tls13 ${label}`);
  const info = new Uint8Array(2 + 1 + fullLabel.length + 1 + context.length);
  info[0] = (length >> 8) & 0xff;
  info[1] = length & 0xff;
  info[2] = fullLabel.length;
  info.set(fullLabel, 3);
  info[3 + fullLabel.length] = context.length;
  info.set(context, 4 + fullLabel.length);
  return hkdfExpand(hash, secret, info, length);
}

export interface TrafficKeys {
  key: Uint8Array;
  iv: Uint8Array;
}

export async function deriveTrafficKeys(
  secret: Uint8Array,
  hash: 'SHA-256' | 'SHA-384',
  keyLength: 16 | 32,
): Promise<TrafficKeys> {
  return {
    key: await hkdfExpandLabel(hash, secret, 'key', new Uint8Array(0), keyLength),
    iv: await hkdfExpandLabel(hash, secret, 'iv', new Uint8Array(0), 12),
  };
}

/**
 * The per-record nonce: the static IV exclusive-ored with the record sequence
 * number. No nonce is ever sent on the wire, because both ends can count.
 */
export function recordNonce(iv: Uint8Array, sequence: number): Uint8Array {
  const nonce = iv.slice();
  // The sequence number is 64 bits, right-aligned against the 12 byte IV.
  // Division rather than `>>>` on purpose: JavaScript's shift operators take
  // their right operand modulo 32, so `n >>> 32` silently means `n >>> 0` and
  // would corrupt the four high bytes of the nonce for every record after the
  // first.
  for (let i = 0; i < 8; i++) {
    nonce[nonce.length - 1 - i] ^= Math.floor(sequence / 2 ** (8 * i)) & 0xff;
  }
  return nonce;
}

export interface DecryptedRecord {
  /** The real content type, hidden in the last byte of the plaintext. */
  innerType: number;
  plaintext: Uint8Array;
}

/**
 * Decrypts one record. The five bytes of record header are the additional
 * authenticated data, so tampering with the declared length is detected too.
 */
export async function decryptRecord(
  record: TlsRecord,
  keys: TrafficKeys,
  sequence: number,
): Promise<DecryptedRecord | null> {
  const aad = new Uint8Array(5);
  aad[0] = record.contentType;
  aad[1] = record.legacyVersion >> 8;
  aad[2] = record.legacyVersion & 0xff;
  aad[3] = (record.length >> 8) & 0xff;
  aad[4] = record.length & 0xff;

  try {
    const key = await crypto.subtle.importKey('raw', keys.key as BufferSource, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: recordNonce(keys.iv, sequence) as BufferSource,
          additionalData: aad as BufferSource,
          tagLength: 128,
        },
        key,
        record.payload as BufferSource,
      ),
    );
    // Trailing zero padding, then the real content type.
    let end = plain.length - 1;
    while (end >= 0 && plain[end] === 0) end--;
    if (end < 0) return null;
    return { innerType: plain[end], plaintext: plain.subarray(0, end) };
  } catch {
    return null;
  }
}
