/**
 * Every byte of the TLS record belongs to somebody.
 *
 * Defect, 2026-08-29: the TLS layer declared a 16 byte trailer, the size of
 * the AEAD tag. TLS 1.3 appends one more byte before that: the true record
 * type, hidden inside the encryption so the wire only ever shows "application
 * data". That byte is TLS's own framing, and counting it as payload is not a
 * rounding error in a project whose whole subject is which bytes each layer
 * adds.
 *
 * It was visible, too. stack-view.ts draws the payload as
 * `total - headerLength - trailerLength`, so the byte was coloured as part of
 * the HTTP request, and the inspector reported 21 bytes of overhead instead
 * of 22.
 */
import { describe, expect, it } from 'vitest';
import { buildJourney, type LayerView } from '../src/core/scenario/journey';

const journey = await buildJourney();
const layer = (protocol: string): LayerView =>
  journey.requestStack.find((view) => view.protocol === protocol)!;

const AEAD_TAG_BYTES = 16;
const TLS_RECORD_HEADER_BYTES = 5;
const INNER_CONTENT_TYPE_BYTES = 1;

describe('the TLS record', () => {
  it('accounts for every byte it holds', () => {
    const tls = layer('tls');
    const http = layer('http');
    expect(tls.headerLength + http.bytes.length + tls.trailerLength).toBe(tls.bytes.length);
  });

  it('counts the hidden record type as its own framing, not as payload', () => {
    expect(layer('tls').trailerLength).toBe(AEAD_TAG_BYTES + INNER_CONTENT_TYPE_BYTES);
  });

  it('keeps the five byte record header it really has', () => {
    expect(layer('tls').headerLength).toBe(TLS_RECORD_HEADER_BYTES);
  });

  it('leaves nothing for the renderer to colour as neither one nor the other', () => {
    // This is the arithmetic stack-view.ts performs to size the payload band.
    for (const view of [...journey.requestStack, ...journey.dnsStack]) {
      const payload = view.bytes.length - view.headerLength - view.trailerLength;
      expect(payload, view.protocol).toBeGreaterThanOrEqual(0);
      expect(view.headerLength + payload + view.trailerLength).toBe(view.bytes.length);
    }
  });

  it('reports an overhead the inspector can add up', () => {
    const tls = layer('tls');
    const http = layer('http');
    expect(tls.headerLength + tls.trailerLength).toBe(tls.bytes.length - http.bytes.length);
  });
});
