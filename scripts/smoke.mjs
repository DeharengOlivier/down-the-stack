/**
 * The one end-to-end check: does the built page actually run?
 *
 * Everything else in the suite runs in node, where there is no WebGL, no
 * canvas and no browser. That leaves one question no unit test can answer:
 * whether the thing a visitor loads boots, renders and keeps time. This drives
 * the production build in a real headless Chrome and asserts exactly that.
 *
 * No new dependency: it speaks the DevTools Protocol over the WebSocket node
 * already has, and uses whichever Chrome is installed.
 *
 *   npm run build && node scripts/smoke.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SMOKE_PORT ?? 4180);
const URL_UNDER_TEST = `http://127.0.0.1:${PORT}/`;

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const failures = [];
const check = (condition, description) => {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${description}`);
  if (!condition) failures.push(description);
};

/** Polls an endpoint until it answers, so no fixed sleep decides the timing. */
async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await sleep(250);
  }
  throw new Error(`${url} never answered within ${timeoutMs} ms`);
}

/**
 * The debugging port Chrome actually opened.
 *
 * Asked for on the command line as 0 and read back from the profile, rather
 * than fixed: a fixed port silently connects to whatever else is listening on
 * it, and debugging why the page has no WebGL is a great deal harder when the
 * browser answering is somebody else's, started with other flags.
 */
async function debuggingPort(profile, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const [port] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n');
      if (port) return Number(port);
    } catch {
      // Chrome has not written it yet.
    }
    await sleep(200);
  }
  throw new Error('Chrome never reported a debugging port');
}

/** Waits until the browser will actually grant a WebGL context. */
async function waitForWebGL(client, timeoutMs = 30_000) {
  const probe = `(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    return gl ? String(gl.getParameter(gl.RENDERER)) : '';
  })()`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await client.send('Runtime.evaluate', { expression: probe, returnByValue: true });
    const renderer = response.result?.result?.value;
    if (renderer) return renderer;
    await sleep(500);
  }
  throw new Error('the browser never granted a WebGL context');
}

/** A minimal DevTools Protocol client: request/response plus events. */
async function connect(target) {
  const socket = new WebSocket(target);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) pending.get(message.id)?.(message);
    else listeners.get(message.method)?.forEach((handler) => handler(message.params));
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', reject);
  });
  return {
    send: (method, params = {}) =>
      new Promise((resolve) => {
        const id = ++nextId;
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      }),
    on: (method, handler) => {
      listeners.set(method, [...(listeners.get(method) ?? []), handler]);
    },
    close: () => socket.close(),
  };
}

// --host 127.0.0.1 rather than the default: on a machine that resolves
// localhost to ::1 first, a server bound only to IPv6 is a server this script
// cannot reach.
const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'inherit',
});

const profile = mkdtempSync(path.join(tmpdir(), 'dts-smoke-'));
const chromeBinary = CHROME_CANDIDATES[0];
const chrome = spawn(
  chromeBinary,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    // A CI runner has no GPU, so WebGL falls back to the software rasteriser,
    // which recent Chrome versions refuse to use unless asked explicitly.
    '--enable-unsafe-swiftshader',
    '--disable-dev-shm-usage',
    // Chrome cannot use its sandbox as root, which is how it runs in a CI
    // container. Locally it keeps it.
    ...(process.env.CI ? ['--no-sandbox'] : []),
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let client;
try {
  await waitForServer(URL_UNDER_TEST);
  const debugPort = await debuggingPort(profile);
  await waitForServer(`http://127.0.0.1:${debugPort}/json/version`);

  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  client = await connect(page.webSocketDebuggerUrl);

  const consoleErrors = [];
  client.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') consoleErrors.push(args.map((a) => a.value ?? a.description).join(' '));
  });
  client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    consoleErrors.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
  });

  await client.send('Page.enable');
  await client.send('Runtime.enable');

  // The debugging port answers before the GPU process is ready, and a page
  // that asks for a WebGL context in that window is refused one. Ask for a
  // throwaway context first, until one is granted.
  const renderer = await waitForWebGL(client);
  console.log('  WebGL renderer:', renderer);

  await client.send('Page.navigate', { url: URL_UNDER_TEST });
  await sleep(8000);

  const evaluate = async (expression) => {
    const response = await client.send('Runtime.evaluate', { expression, returnByValue: true });
    return response.result?.result?.value;
  };

  const snapshot = () =>
    evaluate(`JSON.stringify({
      failure: document.querySelector('.failure')?.textContent?.trim() ?? null,
      chapter: document.querySelector('.chapter h1')?.textContent?.trim() ?? null,
      index: document.querySelector('.chapter__index')?.textContent?.trim() ?? null,
      button: document.querySelector('.button--primary')?.textContent?.trim() ?? null,
      t: Number(document.querySelector('input[type=range]')?.value ?? -1),
      bytes: document.querySelectorAll('.hex__byte').length,
      canvas: (() => { const c = document.querySelector('canvas'); return c ? c.width * c.height : 0; })(),
    })`);

  const first = JSON.parse(await snapshot());
  console.log('  page after load:', first);

  check(first.failure === null, 'the page reports no failure of its own');
  check(first.chapter !== null && first.chapter.length > 0, 'a chapter title is on screen');
  check(first.canvas > 0, 'the WebGL canvas has a drawing buffer');
  check(first.bytes > 0, 'the inspector shows the bytes of the current layer');

  await sleep(2500);
  const later = JSON.parse(await snapshot());
  check(later.t > first.t, `the timeline advances on its own (${first.t} -> ${later.t})`);

  // The keyboard path, end to end: space must stop the clock.
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(1200);
  const paused = JSON.parse(await snapshot());
  await sleep(1200);
  const stillPaused = JSON.parse(await snapshot());
  check(stillPaused.t === paused.t, `space pauses the timeline (held at ${paused.t})`);

  check(consoleErrors.length === 0, `no console error (${consoleErrors.join(' | ') || 'none'})`);
} finally {
  client?.close();
  // Waited for rather than only signalled: Chrome writes its profile as it
  // shuts down, and removing the directory underneath it fails.
  const exited = new Promise((resolve) => chrome.once('exit', resolve));
  chrome.kill();
  preview.kill();
  await Promise.race([exited, sleep(5000)]);
  // Chrome is still flushing its profile as it exits, and a leftover temp
  // directory is not a reason to fail a build.
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    console.warn(`could not remove ${profile}`);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} smoke check(s) failed.`);
  process.exit(1);
}
console.log('\nSmoke checks passed.');
process.exit(0);
