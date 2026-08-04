/**
 * The two integrity functions the journey shows being computed.
 *
 * They are worth understanding as a pair, because they answer different
 * questions. The Internet checksum is cheap, additive and weak: it catches the
 * clumsy corruption a router might introduce while rewriting a header. The
 * Ethernet CRC is a polynomial remainder, far stronger, and guards the frame
 * against the noise of the physical medium it just crossed.
 */

/**
 * RFC 1071. Sixteen-bit one's complement of the one's complement sum.
 *
 * The defining property, which the tests rely on: running this over a buffer
 * that already contains its own checksum yields zero. That is exactly how a
 * receiver validates a header without knowing where the checksum field is.
 */
export function internetChecksum(data: Uint8Array, initial = 0): number {
  let sum = initial;
  const n = data.length;
  let i = 0;
  for (; i + 1 < n; i += 2) sum += (data[i] << 8) | data[i + 1];
  if (i < n) sum += data[i] << 8; // odd trailing byte is padded on the right
  while (sum >>> 16) sum = (sum & 0xffff) + (sum >>> 16);
  return (~sum) & 0xffff;
}

/** Sum used when a checksum spans several buffers, such as a pseudo-header. */
export function checksumParts(parts: Uint8Array[]): number {
  let sum = 0;
  for (const part of parts) {
    let i = 0;
    for (; i + 1 < part.length; i += 2) sum += (part[i] << 8) | part[i + 1];
    if (i < part.length) sum += part[i] << 8;
    while (sum >>> 16) sum = (sum & 0xffff) + (sum >>> 16);
  }
  return (~sum) & 0xffff;
}

/**
 * The twelve-byte pseudo-header IPv4 lends to TCP and UDP.
 *
 * It is a small scandal of layering: the transport checksum deliberately covers
 * addresses that belong to the layer below, so a packet delivered to the wrong
 * host fails its transport check. The simulation points this out rather than
 * hiding it.
 */
export function ipv4PseudoHeader(
  src: Uint8Array,
  dst: Uint8Array,
  protocol: number,
  length: number,
): Uint8Array {
  const ph = new Uint8Array(12);
  ph.set(src, 0);
  ph.set(dst, 4);
  ph[8] = 0;
  ph[9] = protocol;
  ph[10] = (length >>> 8) & 0xff;
  ph[11] = length & 0xff;
  return ph;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * CRC-32 as used by the Ethernet frame check sequence: reflected, initialised
 * to all ones, and finally inverted. Identical to the CRC in zip and PNG, which
 * is what lets the tests cross-check it against Node's own implementation.
 */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
