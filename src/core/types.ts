/**
 * The vocabulary every layer of the project shares.
 *
 * A `Field` is the atom: a named run of bits inside a header, with everything
 * needed to draw it and to explain it. The byte inspector renders `Field`s and
 * knows nothing about any particular protocol, which is why adding a protocol
 * never means touching the interface.
 */

export type LayerNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Field {
  /** Stable identifier used to look up the explanation: `ipv4.ttl`. */
  key: string;
  /** English label, also the fallback when a translation is missing. */
  label: string;
  /** Offset in bits from the start of the header that owns this field. */
  bitOffset: number;
  bitLength: number;
  /** The value as a number when it fits, as a string otherwise. */
  value: number | string;
  /** How a human reads it: `64 hops`, `TCP`, `don't fragment`. */
  display: string;
  /** Sub-fields, for things like the TCP flag byte. */
  children?: Field[];
}

export interface Header {
  /** Lowercase protocol id, matching the module that produced it. */
  protocol: string;
  layer: LayerNumber;
  /** Offset in bytes from the start of the PDU this header belongs to. */
  byteOffset: number;
  byteLength: number;
  fields: Field[];
  /** One line, the way a packet list would show it. */
  summary: string;
}

/**
 * A protocol data unit: some bytes, the headers found in them, and where the
 * payload starts. Every layer produces one of these.
 */
export interface Pdu {
  bytes: Uint8Array;
  headers: Header[];
  payloadOffset: number;
  payloadLength: number;
}

export const LAYER_NAMES: Record<LayerNumber, string> = {
  7: 'Application',
  6: 'Presentation',
  5: 'Session',
  4: 'Transport',
  3: 'Network',
  2: 'Data link',
  1: 'Physical',
};

/** Total size in bits of a field list, useful for asserting header layouts. */
export function fieldsBitLength(fields: Field[]): number {
  return fields.reduce((n, f) => Math.max(n, f.bitOffset + f.bitLength), 0);
}
