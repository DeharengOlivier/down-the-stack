/**
 * Proves the decryption is real.
 *
 * If these pass, the moment in the simulation where ciphertext becomes a
 * readable request is an actual AES-GCM operation on actual captured bytes, and
 * not a scripted reveal.
 */
import { describe, expect, it } from 'vitest';
import { loadSession } from '../src/core/scenario/capture';
import { CIPHER_PARAMS, decryptStream } from '../src/core/scenario/tls-session';
import { describeHello, parseHandshake, parseRecords } from '../src/core/protocols/tls';

const decoder = new TextDecoder();

describe('the captured TLS session', () => {
  it('starts with a ClientHello naming the site it wants', () => {
    const session = loadSession();
    const records = parseRecords(session.clientStream);
    expect(records[0]!.contentType).toBe(22);
    const [hello] = parseHandshake(records[0]!.payload, 0);
    expect(hello!.type).toBe(1);
    const described = describeHello(hello!);
    const sni = described.fields.find((f) => f.key === 'tls.ext.server_name');
    expect(sni?.display).toBe('example.com');
  });

  it('reveals the HTTP request hidden inside the encrypted records', async () => {
    const session = loadSession();
    const records = await decryptStream(session.clientStream, session.keylog, 'client', CIPHER_PARAMS[0x1302]!);

    const application = records.filter((r) => r.phase === 'application' && r.innerType === 23);
    expect(application.length).toBeGreaterThan(0);

    const text = application.map((r) => decoder.decode(r.decrypted!)).join('');
    expect(text).toContain('GET / HTTP/1.1');
    expect(text).toContain('Host: example.com');
  });

  it('reveals the server response, headers and body', async () => {
    const session = loadSession();
    const records = await decryptStream(session.serverStream, session.keylog, 'server', CIPHER_PARAMS[0x1302]!);

    const application = records.filter((r) => r.phase === 'application' && r.innerType === 23);
    const text = application.map((r) => decoder.decode(r.decrypted!)).join('');
    expect(text).toContain('HTTP/1.1 200 OK');
    expect(text).toContain('Server: cloudflare');
    // The body arrives chunked, each piece prefixed by its length in hex.
    expect(text).toContain('Transfer-Encoding: chunked');
    expect(text).toContain('<!doctype html>');
    expect(text).toContain('Example Domain');
  });

  it('decrypts the server certificate out of the handshake', async () => {
    const session = loadSession();
    const records = await decryptStream(session.serverStream, session.keylog, 'server', CIPHER_PARAMS[0x1302]!);

    // Inner content type 22 means the record held handshake messages that were
    // themselves encrypted, which is new in TLS 1.3: the certificate no longer
    // travels in the clear.
    const handshake = records.filter((r) => r.phase === 'handshake' && r.innerType === 22);
    expect(handshake.length).toBeGreaterThan(0);

    const types = handshake.flatMap((r) => parseHandshake(r.decrypted!).map((m) => m.type));
    expect(types).toContain(8); // EncryptedExtensions
    expect(types).toContain(11); // Certificate
    expect(types).toContain(20); // Finished
  });
});
