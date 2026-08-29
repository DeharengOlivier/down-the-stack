/**
 * The one layer a human can read, held to the same standard as the rest.
 *
 * The request below is not written from imagination: it is the request the
 * capture proves was sent, recovered by decrypting the TLS session. The
 * encoder is handed its fields and must produce those exact bytes, blank line
 * and carriage returns included.
 *
 * This matters more than it looks. HTTP framing is text, and text is where a
 * simulation is most tempted to be approximate: a missing \r, a header joined
 * with a space instead of ": ", a body separated by one newline instead of two.
 * Every one of those parses fine in a browser and is wrong on the wire.
 */
import { describe, expect, it } from 'vitest';
import { loadSession } from '../src/core/scenario/capture';
import { CIPHER_PARAMS, decryptStream } from '../src/core/scenario/tls-session';
import { describeHttp, encodeHttpRequest } from '../src/core/protocols/http';

const decoder = new TextDecoder();

async function capturedRequest(): Promise<Uint8Array> {
  const session = loadSession();
  const records = await decryptStream(
    session.clientStream,
    session.keylog,
    'client',
    CIPHER_PARAMS[0x1302]!,
  );
  const payloads = records
    .filter((r) => r.phase === 'application' && r.innerType === 23)
    .map((record) => {
      if (!record.decrypted) throw new Error('a record in the application phase did not decrypt');
      return record.decrypted;
    });
  const out = new Uint8Array(payloads.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const payload of payloads) {
    out.set(payload, at);
    at += payload.length;
  }
  return out;
}

describe('the request that was actually sent', () => {
  it('is reproduced byte for byte from its field values', async () => {
    const captured = await capturedRequest();

    const encoded = encodeHttpRequest({
      method: 'GET',
      target: '/',
      headers: [
        ['Host', 'example.com'],
        ['User-Agent', 'down-the-stack/0.1'],
        ['Accept', '*/*'],
        ['Connection', 'close'],
      ],
    });

    expect(decoder.decode(encoded)).toBe(decoder.decode(captured));
    expect(Array.from(encoded)).toEqual(Array.from(captured));
  });

  it('ends on the blank line that says the headers are over', async () => {
    const captured = await capturedRequest();
    expect(Array.from(captured.subarray(-4))).toEqual([0x0d, 0x0a, 0x0d, 0x0a]);
  });

  it('separates every line with CRLF and never with a bare newline', async () => {
    const text = decoder.decode(await capturedRequest());
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
  });
});

describe('the encoder on its own terms', () => {
  it('defaults to HTTP/1.1 without being told', () => {
    const line = decoder.decode(encodeHttpRequest({ method: 'GET', target: '/', headers: [] }));
    expect(line).toBe('GET / HTTP/1.1\r\n\r\n');
  });

  it('writes the version it is given', () => {
    const line = decoder.decode(
      encodeHttpRequest({ method: 'GET', target: '/', version: 'HTTP/1.0', headers: [] }),
    );
    expect(line.startsWith('GET / HTTP/1.0\r\n')).toBe(true);
  });

  it('keeps headers in the order they were given', () => {
    // Order is not semantically meaningful in HTTP, but it is on the wire, and
    // reproducing a capture means reproducing the order the client chose.
    const text = decoder.decode(
      encodeHttpRequest({
        method: 'GET',
        target: '/',
        headers: [
          ['B', '2'],
          ['A', '1'],
        ],
      }),
    );
    expect(text.indexOf('B: 2')).toBeLessThan(text.indexOf('A: 1'));
  });

  it('produces a request with no headers that is still correctly framed', () => {
    const bytes = encodeHttpRequest({ method: 'HEAD', target: '/x', headers: [] });
    expect(Array.from(bytes.subarray(-4))).toEqual([0x0d, 0x0a, 0x0d, 0x0a]);
  });
});

describe('reading a request back', () => {
  it('names every header of the captured request, in order', async () => {
    const header = describeHttp(await capturedRequest());
    const names = header.fields
      .filter((f) => f.key.startsWith('http.header.'))
      .map((f) => f.label);
    expect(names).toEqual(['Host', 'User-Agent', 'Accept', 'Connection']);
  });

  it('points each field at the bytes it actually occupies', async () => {
    const captured = await capturedRequest();
    const text = decoder.decode(captured);
    const header = describeHttp(captured);
    for (const field of header.fields) {
      if (!field.key.startsWith('http.header.')) continue;
      const at = field.bitOffset / 8;
      // The inspector highlights bytes by this offset: if it drifts, the
      // interface underlines the wrong line while claiming to explain another.
      expect(text.slice(at, at + field.label.length), field.label).toBe(field.label);
    }
  });

  it('recognises a response and calls its first line a status line', () => {
    const header = describeHttp(new TextEncoder().encode('HTTP/1.1 200 OK\r\nServer: x\r\n\r\n'));
    expect(header.fields[0]!.key).toBe('http.status_line');
    expect(header.summary).toBe('HTTP/1.1 200 OK');
  });

  it('measures the body it did not include in the header length', () => {
    const header = describeHttp(
      new TextEncoder().encode('HTTP/1.1 200 OK\r\nServer: x\r\n\r\nhello'),
    );
    expect(header.byteLength).toBe('HTTP/1.1 200 OK\r\nServer: x\r\n\r\n'.length);
  });
});
