import type { Field, Header } from '../types';
import { ByteWriter } from '../bytes/writer';

/**
 * HTTP/1.1, the only layer of the journey a human can read without a tool.
 *
 * Worth pausing on for that reason alone: after the ceremony of headers,
 * checksums and key exchanges below it, the thing everyone actually wanted to
 * send turns out to be a few lines of text ending in blank line.
 */

export interface HttpRequestFields {
  method: string;
  target: string;
  version?: string;
  headers: [string, string][];
}

export function encodeHttpRequest(f: HttpRequestFields): Uint8Array {
  const w = new ByteWriter(512);
  w.ascii(`${f.method} ${f.target} ${f.version ?? 'HTTP/1.1'}\r\n`);
  for (const [name, value] of f.headers) w.ascii(`${name}: ${value}\r\n`);
  // The empty line is the entire framing mechanism: it says the headers are
  // over. Everything after it is body.
  w.ascii('\r\n');
  return w.bytes();
}

const decoder = new TextDecoder('utf-8', { fatal: false });

export function describeHttp(bytes: Uint8Array, byteOffset = 0): Header {
  const text = decoder.decode(bytes.subarray(byteOffset));
  const headerEnd = text.indexOf('\r\n\r\n');
  const head = headerEnd >= 0 ? text.slice(0, headerEnd) : text;
  const lines = head.split('\r\n');
  const startLine = lines[0] ?? '';
  const isResponse = startLine.startsWith('HTTP/');

  const fields: Field[] = [];
  let cursor = 0;

  fields.push({
    key: isResponse ? 'http.status_line' : 'http.request_line',
    label: isResponse ? 'Status line' : 'Request line',
    bitOffset: 0,
    bitLength: startLine.length * 8,
    value: startLine,
    display: startLine,
  });
  cursor += startLine.length + 2;

  for (const line of lines.slice(1)) {
    if (!line) break;
    const colon = line.indexOf(':');
    const name = colon >= 0 ? line.slice(0, colon) : line;
    const value = colon >= 0 ? line.slice(colon + 1).trim() : '';
    fields.push({
      key: `http.header.${name.toLowerCase()}`,
      label: name,
      bitOffset: cursor * 8,
      bitLength: line.length * 8,
      value,
      display: value,
    });
    cursor += line.length + 2;
  }

  fields.push({
    key: 'http.blank_line',
    label: 'Blank line',
    bitOffset: cursor * 8,
    bitLength: 16,
    value: '\\r\\n',
    display: 'two bytes that mean the headers are finished',
  });

  const bodyLength = headerEnd >= 0 ? text.length - headerEnd - 4 : 0;

  return {
    protocol: 'http',
    layer: 7,
    byteOffset,
    byteLength: headerEnd >= 0 ? headerEnd + 4 : text.length,
    summary: isResponse ? startLine : `${startLine}${bodyLength ? `, ${bodyLength} bytes of body` : ''}`,
    fields,
  };
}
