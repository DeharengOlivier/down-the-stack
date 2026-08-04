/**
 * Records the ground truth for the simulation.
 *
 * Runs a real DNS query and a real HTTPS page load while capturing every frame
 * that leaves and enters the machine. The resulting pcap is the reference our
 * encoders must reproduce byte for byte.
 *
 * No sudo needed when Wireshark's ChmodBPF is installed.
 *
 *   node scripts/capture.mjs
 */
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'fixtures');
const HOST = process.env.DTS_HOST ?? 'example.com';
const RESOLVER = process.env.DTS_RESOLVER ?? '1.1.1.1';

mkdirSync(FIXTURES, { recursive: true });

function defaultInterface() {
  const out = execSync('route -n get default 2>/dev/null').toString();
  const m = out.match(/interface:\s*(\S+)/);
  if (!m) throw new Error('no default route found');
  return m[1];
}

const iface = defaultInterface();
console.log(`interface: ${iface}`);

const pcapPath = path.join(FIXTURES, 'session.pcap');
const keylogPath = path.join(FIXTURES, 'session.keylog');

const tcpdump = spawn('tcpdump', [
  '-i', iface,
  '-s', '0',
  '-w', pcapPath,
  '-U',
  'udp port 53 or tcp port 443',
]);
tcpdump.stderr.on('data', (d) => process.stderr.write(`[tcpdump] ${d}`));

// Give the capture time to attach to the BPF device before generating traffic.
await sleep(1500);

// A real DNS query, produced by BIND's dig rather than by us, so the wire
// format is an independent implementation's output.
console.log('dns query...');
try {
  execSync(`dig +noedns +timeout=5 @${RESOLVER} ${HOST} A`, { stdio: 'pipe' });
} catch (e) {
  console.error('dig failed:', e.message);
}

await sleep(500);

console.log('https request...');
const keylog = [];
const body = await new Promise((resolve, reject) => {
  const req = https.request(
    {
      host: HOST,
      port: 443,
      path: '/',
      method: 'GET',
      // IPv4 on purpose. The machine would happily pick IPv6, but IPv4 is the
      // canonical teaching case: it has a header checksum and fragmentation,
      // both of which the simulation shows.
      family: 4,
      // Force HTTP/1.1 so the application layer stays readable text.
      ALPNProtocols: ['http/1.1'],
      headers: { Host: HOST, 'User-Agent': 'down-the-stack/0.1', Accept: '*/*' },
      agent: false,
    },
    (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    },
  );
  req.on('socket', (socket) => {
    socket.on('keylog', (line) => keylog.push(line.toString()));
  });
  req.on('error', reject);
  req.end();
});

console.log(`http ${body.status}, ${body.body.length} bytes`);

await sleep(1500);
tcpdump.kill('SIGINT');
await new Promise((r) => tcpdump.on('close', r));

writeFileSync(keylogPath, keylog.join(''));
writeFileSync(
  path.join(FIXTURES, 'session.meta.json'),
  JSON.stringify(
    { host: HOST, resolver: RESOLVER, interface: iface, status: body.status, bodyLength: body.body.length },
    null,
    2,
  ) + '\n',
);

console.log(`wrote ${pcapPath}`);
console.log(`wrote ${keylogPath} (${keylog.length} secrets)`);
