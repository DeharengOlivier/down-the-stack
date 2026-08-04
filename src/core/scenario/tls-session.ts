import {
  CONTENT_TYPE,
  decryptRecord,
  deriveTrafficKeys,
  parseKeylog,
  parseRecords,
  type TlsRecord,
  type TrafficKeys,
} from '../protocols/tls';

/**
 * Walks one direction of a TLS 1.3 conversation and decrypts what it can.
 *
 * The only subtlety is knowing when the keys change. TLS 1.3 sends no marker
 * for it: after the handshake keys stop working, the application keys start,
 * and the record sequence number resets to zero. So this tries the handshake
 * keys, and the first record they fail on is the first application record.
 * That is also exactly what the peer does.
 */

export interface CipherParams {
  hash: 'SHA-256' | 'SHA-384';
  keyLength: 16 | 32;
  name: string;
}

export const CIPHER_PARAMS: Record<number, CipherParams> = {
  0x1301: { hash: 'SHA-256', keyLength: 16, name: 'TLS_AES_128_GCM_SHA256' },
  0x1302: { hash: 'SHA-384', keyLength: 32, name: 'TLS_AES_256_GCM_SHA384' },
};

export interface AnnotatedRecord {
  record: TlsRecord;
  /** `plaintext` for records that were never encrypted. */
  phase: 'plaintext' | 'handshake' | 'application';
  sequence: number | null;
  innerType: number | null;
  decrypted: Uint8Array | null;
}

export async function decryptStream(
  stream: Uint8Array,
  keylogText: string,
  side: 'client' | 'server',
  cipher: CipherParams,
): Promise<AnnotatedRecord[]> {
  const secrets = parseKeylog(keylogText);
  const handshakeSecret = side === 'client' ? secrets.clientHandshake : secrets.serverHandshake;
  const applicationSecret = side === 'client' ? secrets.clientApplication : secrets.serverApplication;

  const handshakeKeys: TrafficKeys | null = handshakeSecret
    ? await deriveTrafficKeys(handshakeSecret, cipher.hash, cipher.keyLength)
    : null;
  const applicationKeys: TrafficKeys | null = applicationSecret
    ? await deriveTrafficKeys(applicationSecret, cipher.hash, cipher.keyLength)
    : null;

  const out: AnnotatedRecord[] = [];
  let phase: 'handshake' | 'application' = 'handshake';
  let handshakeSeq = 0;
  let applicationSeq = 0;

  for (const record of parseRecords(stream)) {
    if (record.contentType !== 23) {
      out.push({ record, phase: 'plaintext', sequence: null, innerType: record.contentType, decrypted: null });
      continue;
    }

    if (phase === 'handshake' && handshakeKeys) {
      const result = await decryptRecord(record, handshakeKeys, handshakeSeq);
      if (result) {
        out.push({ record, phase: 'handshake', sequence: handshakeSeq, innerType: result.innerType, decrypted: result.plaintext });
        handshakeSeq += 1;
        continue;
      }
      phase = 'application';
    }

    if (applicationKeys) {
      const result = await decryptRecord(record, applicationKeys, applicationSeq);
      if (result) {
        out.push({ record, phase: 'application', sequence: applicationSeq, innerType: result.innerType, decrypted: result.plaintext });
        applicationSeq += 1;
        continue;
      }
    }

    out.push({ record, phase: 'application', sequence: null, innerType: null, decrypted: null });
  }

  return out;
}

export function describePhase(record: AnnotatedRecord): string {
  if (record.phase === 'plaintext') return `${CONTENT_TYPE[record.record.contentType] ?? '?'}, sent in the clear`;
  if (!record.decrypted) return 'encrypted, not decrypted';
  return `${CONTENT_TYPE[record.innerType ?? 0] ?? 'unknown'}, decrypted with the ${record.phase} keys`;
}
