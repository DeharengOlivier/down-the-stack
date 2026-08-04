/**
 * Turns the raw capture into a publishable fixture.
 *
 * Three jobs:
 *   1. keep only our DNS exchange and our one HTTPS conversation, dropping
 *      every other application's traffic that happened to be on the wire,
 *   2. replace the real MAC addresses, which identify the physical machine and
 *      the physical router, with locally administered stand-ins,
 *   3. emit ground-truth.json: the exact bytes of every frame, which the
 *      encoder tests must reproduce.
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
  frames.push({
    index: index++,
    tNs: BigInt(tsSec) * 1_000_000_000n + BigInt(nanos ? tsFrac : tsFrac * 1000),
    hex: buf.subarray(dataOff, dataOff + caplen).toString('hex'),
  });
  off = dataOff + caplen;
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
  note: 'Real capture. MAC addresses replaced with locally administered stand-ins.',
  keylog,
  frames: frames.map((f) => ({ index: f.index, tNs: Number(f.tNs - t0), hex: f.hex })),
};
writeFileSync(JSON_OUT, JSON.stringify(payload, null, 2) + '\n');

console.log(`${frames.length} frames kept`);
console.log(`macs remapped: ${[...macs.keys()].length}`);
console.log(`wrote ${OUT}`);
console.log(`wrote ${JSON_OUT}`);
