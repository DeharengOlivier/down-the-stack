/**
 * Turns the raw capture into a publishable fixture.
 *
 * Five jobs:
 *   1. keep only our DNS exchange and our one HTTPS conversation, dropping
 *      every other application's traffic that happened to be on the wire,
 *   2. replace the real MAC addresses, which identify the physical machine and
 *      the physical router, with locally administered stand-ins,
 *   3. replace the private addresses of the machines on the local network,
 *      recomputing every checksum that covered them,
 *   4. rebase the timestamps so the fixture says how long things took without
 *      saying when somebody was at their desk,
 *   5. emit ground-truth.json: the exact bytes of every frame, which the
 *      encoder tests must reproduce.
 *
 * The public addresses are left alone. A DNS resolver and a web server are
 * public services, and hiding them would only make the capture less checkable.
 *
 *   node scripts/extract.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'fixtures');
const TSHARK = process.env.TSHARK ?? '/Applications/Wireshark.app/Contents/MacOS/tshark';

const RAW = path.join(FIXTURES, 'session.pcap');
const OUT = path.join(FIXTURES, 'ground-truth.pcap');
const JSON_OUT = path.join(FIXTURES, 'ground-truth.json');

const meta = JSON.parse(readFileSync(path.join(FIXTURES, 'session.meta.json'), 'utf8'));

function tshark(args) {
  return execFileSync(TSHARK, args, { maxBuffer: 256 * 1024 * 1024 }).toString();
}

// Find the server address our request actually reached, and the tcp stream id.
const rows = tshark([
  '-r', RAW,
  '-Y', 'tls.handshake.extensions_server_name == "' + meta.host + '"',
  '-T', 'fields', '-e', 'ip.dst', '-e', 'tcp.stream',
]).trim().split('\n').filter(Boolean);
if (rows.length === 0) throw new Error('no ClientHello for ' + meta.host + ' found in capture');
const [serverIp, stream] = rows[0].split('\t');
console.log(`server ${serverIp}, tcp stream ${stream}`);

// The DNS query for our host, plus the whole TCP conversation.
const filter = `(dns.qry.name == "${meta.host}") or (tcp.stream == ${stream})`;
// -F pcap because the byte rewriting below walks the classic libpcap layout,
// and tshark writes pcapng unless told otherwise.
tshark(['-r', RAW, '-Y', filter, '-F', 'pcap', '-w', OUT]);

// --- MAC anonymisation, done directly on the pcap bytes -------------------
// libpcap format: 24 byte global header, then per record a 16 byte header
// (ts_sec, ts_usec, caplen, origlen) followed by caplen bytes of frame.
const buf = readFileSync(OUT);
const magic = buf.readUInt32LE(0);
const nanos = magic === 0xa1b23c4d || magic === 0x4d3cb2a1;
const swapped = magic === 0xd4c3b2a1 || magic === 0x4d3cb2a1;
const u32 = (off) => (swapped ? buf.readUInt32BE(off) : buf.readUInt32LE(off));
const linkType = u32(20);
if (linkType !== 1) throw new Error(`expected Ethernet link type, got ${linkType}`);

// The wall clock the capture happened on says when the machine was in use.
// Only the intervals matter here, so the first frame is pinned to a neutral
// instant and every other frame keeps its distance from it.
const BASE_EPOCH_SECONDS = 1767225600; // 2026-01-01T00:00:00Z

const writeU32 = (off, value) => {
  if (swapped) buf.writeUInt32BE(value, off);
  else buf.writeUInt32LE(value, off);
};

/**
 * The Internet checksum of RFC 1071: sum the 16-bit words, fold the carries
 * back in, complement. Written out here rather than imported from src/,
 * because this script is plain node and the implementation there is
 * TypeScript. The two are checked against each other by the test suite: the
 * encoders reproduce these frames byte for byte, checksums included.
 */
function internetChecksum(bytes) {
  let sum = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) sum += (bytes[i] << 8) | bytes[i + 1];
  if (bytes.length % 2 === 1) sum += bytes[bytes.length - 1] << 8;
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  return (~sum) & 0xffff;
}

const PRIVATE_RANGES = [
  (a) => a[0] === 10,
  (a) => a[0] === 172 && a[1] >= 16 && a[1] <= 31,
  (a) => a[0] === 192 && a[1] === 168,
  (a) => a[0] === 169 && a[1] === 254,
];
const isPrivate = (address) => PRIVATE_RANGES.some((test) => test(address));

const privateAddresses = new Map();
const privateReplacements = [
  [192, 168, 1, 100], // the laptop
  [192, 168, 1, 1], // the gateway, should it ever appear as an endpoint
];
function standInFor(address) {
  const key = address.join('.');
  if (!privateAddresses.has(key)) {
    const next = privateReplacements[privateAddresses.size] ?? [192, 168, 1, 200 + privateAddresses.size];
    privateAddresses.set(key, next);
  }
  return privateAddresses.get(key);
}

/**
 * Rewrites the private endpoints of one IPv4 frame and repairs the checksums.
 *
 * The header checksum covers the addresses directly; the TCP and UDP ones
 * cover them through the pseudo-header, so all three have to be recomputed
 * from the rewritten bytes rather than patched.
 */
function mapAddresses(frameOff, caplen) {
  const frame = buf.subarray(frameOff, frameOff + caplen);
  if (frame.length < 14 || frame.readUInt16BE(12) !== 0x0800) return;
  const ip = frame.subarray(14);
  if (ip.length < 20) return;
  const ihl = (ip[0] & 0x0f) * 4;
  if (ip.length < ihl) return;

  let touched = false;
  for (const at of [12, 16]) {
    const address = [ip[at], ip[at + 1], ip[at + 2], ip[at + 3]];
    if (!isPrivate(address)) continue;
    Buffer.from(standInFor(address)).copy(ip, at);
    touched = true;
  }
  if (!touched) return;

  ip.writeUInt16BE(0, 10);
  ip.writeUInt16BE(internetChecksum(ip.subarray(0, ihl)), 10);

  const protocol = ip[9];
  if (protocol !== 6 && protocol !== 17) return;
  const total = ip.readUInt16BE(2);
  const layer4 = ip.subarray(ihl, total);
  const checksumAt = protocol === 6 ? 16 : 6;
  // A UDP datagram is allowed to carry no checksum at all, and a zero there
  // means exactly that. Computing one would change what the capture says.
  if (protocol === 17 && layer4.readUInt16BE(checksumAt) === 0) return;

  const pseudo = Buffer.alloc(12 + layer4.length);
  ip.subarray(12, 20).copy(pseudo, 0);
  pseudo[9] = protocol;
  pseudo.writeUInt16BE(layer4.length, 10);
  layer4.copy(pseudo, 12);
  pseudo.writeUInt16BE(0, 12 + checksumAt);
  let checksum = internetChecksum(pseudo);
  // Zero means "not computed" on the wire, so it is sent as all ones instead.
  if (protocol === 17 && checksum === 0) checksum = 0xffff;
  layer4.writeUInt16BE(checksum, checksumAt);
}

const macs = new Map();
const replacements = [
  [0x02, 0x1a, 0x2b, 0x3c, 0x4d, 0x5e], // the laptop
  [0x02, 0xaa, 0xbb, 0xcc, 0xdd, 0xee], // the access point
  [0x02, 0x11, 0x22, 0x33, 0x44, 0x55], // anything else that shows up
];
function mapMac(off) {
  const key = buf.subarray(off, off + 6).toString('hex');
  if (key === 'ffffffffffff') return; // broadcast stays broadcast
  if (!macs.has(key)) {
    const next = replacements[macs.size] ?? [0x02, 0, 0, 0, 0, macs.size];
    macs.set(key, Buffer.from(next));
  }
  macs.get(key).copy(buf, off);
}

const frames = [];
let off = 24;
let index = 0;
while (off + 16 <= buf.length) {
  const tsSec = u32(off);
  const tsFrac = u32(off + 4);
  const caplen = u32(off + 8);
  const dataOff = off + 16;
  if (dataOff + caplen > buf.length) break;
  // Source before destination: the first frame is the client's DNS query, so
  // mapping source first gives the laptop the first stand-in address.
  mapMac(dataOff + 6);
  mapMac(dataOff);
  mapAddresses(dataOff, caplen);
  frames.push({
    at: off,
    index: index++,
    tNs: BigInt(tsSec) * 1_000_000_000n + BigInt(nanos ? tsFrac : tsFrac * 1000),
    hex: buf.subarray(dataOff, dataOff + caplen).toString('hex'),
  });
  off = dataOff + caplen;
}
// The frames are on hand now, so the rebase is one pass over their headers.
if (frames.length > 0) {
  const first = frames[0].tNs;
  for (const frame of frames) {
    const offset = frame.tNs - first;
    const seconds = BigInt(BASE_EPOCH_SECONDS) + offset / 1_000_000_000n;
    const fraction = offset % 1_000_000_000n;
    writeU32(frame.at, Number(seconds));
    writeU32(frame.at + 4, Number(nanos ? fraction : fraction / 1000n));
  }
}
writeFileSync(OUT, buf);

// Timestamps become relative nanoseconds so the fixture carries no wall clock.
const t0 = frames.length ? frames[0].tNs : 0n;
// The key log travels with the frames so the whole fixture is one import. The
// secrets are ephemeral and belong to this one session against a public page,
// which is the entire point: anyone can repeat the decryption.
const keylog = readFileSync(path.join(FIXTURES, 'session.keylog'), 'utf8');

const payload = {
  host: meta.host,
  serverIp,
  note:
    'Real capture. MAC addresses replaced with locally administered stand-ins, '
    + 'private addresses replaced and their checksums recomputed, timestamps '
    + 'rebased so only the intervals remain.',
  keylog,
  frames: frames.map((f) => ({ index: f.index, tNs: Number(f.tNs - t0), hex: f.hex })),
};
writeFileSync(JSON_OUT, JSON.stringify(payload, null, 2) + '\n');

console.log(`${frames.length} frames kept`);
console.log(`macs remapped: ${[...macs.keys()].length}`);
for (const [was, now] of privateAddresses) console.log(`  ${was} -> ${now.join('.')}`);
console.log(`wrote ${OUT}`);
console.log(`wrote ${JSON_OUT}`);
