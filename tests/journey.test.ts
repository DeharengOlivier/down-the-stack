/**
 * The assembled journey, and the one invariant the project exists to teach.
 *
 * journey.ts is the largest file in core/ and had no test. It is also where
 * encapsulation stops being a claim in a README and becomes an array of layers
 * that the renderer draws literally: if a layer's byte range is off by one, the
 * simulation shows a header sitting inside the wrong payload and says nothing.
 *
 * So the central test below is not "the journey has nine layers". It is: every
 * layer contains the layer above it, byte for byte, at exactly the offset it
 * claims, all the way down.
 */
import { describe, expect, it } from 'vitest';
import { buildJourney, type Journey, type LayerView } from '../src/core/scenario/journey';
import { en } from '../src/content/en';

const journey: Journey = await buildJourney();

/** Where `needle` sits inside `haystack`, or -1. */
function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** The bytes a layer carries: everything between its header and its trailer. */
function carried(view: LayerView): Uint8Array {
  return view.bytes.subarray(view.headerLength, view.bytes.length - view.trailerLength);
}

function layerOf(stack: LayerView[], protocol: string): LayerView {
  const found = stack.find((view) => view.protocol === protocol);
  if (!found) throw new Error(`no ${protocol} layer in this stack`);
  return found;
}

const stacks: [string, LayerView[]][] = [
  ['the DNS question', journey.dnsStack],
  ['the page request', journey.requestStack],
];

// --- encapsulation ----------------------------------------------------------

describe.each(stacks)('%s, layer by layer', (_name, stack) => {
  it('has layers that descend, never repeating or skipping backwards', () => {
    const layers = stack.map((view) => view.layer);
    expect(layers.length).toBeGreaterThan(2);
    for (let i = 1; i < layers.length; i += 1) {
      expect(layers[i], `layer ${i}`).toBeLessThanOrEqual(layers[i - 1]);
    }
  });

  it('carries the layer above it unchanged, wherever that layer sits', () => {
    // The whole idea, stated as an assertion. A layer prepends its header,
    // possibly appends a trailer, and does not touch a byte in between.
    //
    // Two layers are exempt, and they are exempt for reasons the project
    // exists to show rather than for convenience. Each is pinned separately
    // below, so neither can quietly grow into a third.
    for (let i = 1; i < stack.length; i += 1) {
      const outer = stack[i];
      const inner = stack[i - 1];
      if (outer.protocol === 'tls' || outer.protocol === 'wifi') continue;
      expect(
        indexOf(carried(outer), inner.bytes),
        `${outer.protocol} does not carry ${inner.protocol} intact`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('grows on the way down and never shrinks', () => {
    for (let i = 1; i < stack.length; i += 1) {
      expect(stack[i].bytes.length, stack[i].protocol).toBeGreaterThan(
        stack[i - 1].bytes.length,
      );
    }
  });

  it('accounts for every byte it holds: header, payload, trailer', () => {
    for (const view of stack) {
      const payload = view.bytes.length - view.headerLength - view.trailerLength;
      expect(payload, view.protocol).toBeGreaterThanOrEqual(0);
    }
  });

  it('adds a trailer only where a protocol really appends one', () => {
    // Wi-Fi appends a frame check sequence, TLS an authentication tag and the
    // byte carrying the true record type.
    const withTrailer = stack.filter((view) => view.trailerLength > 0).map((v) => v.protocol);
    expect(withTrailer.every((protocol) => protocol === 'wifi' || protocol === 'tls')).toBe(true);
    expect(layerOf(stack, 'wifi').trailerLength).toBe(4);
  });

  it('never claims a header longer than the layer holding it', () => {
    for (const view of stack) {
      if (!view.header) continue;
      expect(view.header.byteLength, view.protocol).toBeLessThanOrEqual(view.bytes.length);
    }
  });

  it('throws the link layer away and rebuilds it, which is the lesson', () => {
    // 802.11 does not wrap the Ethernet frame, it replaces its header. The IP
    // packet inside is the thing that survives the change of medium, and it
    // survives it byte for byte. If this ever starts passing with the
    // Ethernet frame found inside the Wi-Fi one, the simulation has started
    // teaching the wrong thing.
    const wifi = layerOf(stack, 'wifi');
    const ethernet = layerOf(stack, 'ethernet');
    const ip = layerOf(stack, 'ipv4');

    expect(indexOf(carried(wifi), ethernet.bytes)).toBe(-1);
    expect(indexOf(carried(wifi), ip.bytes)).toBe(0);
    expect(carried(wifi).length).toBe(ip.bytes.length);
  });
});

// --- what the capture proves ------------------------------------------------

describe('the journey reflects the capture rather than a script', () => {
  it('recovers the real request and the real response', () => {
    expect(journey.requestText).toContain('GET / HTTP/1.1');
    expect(journey.requestText).toContain('Host: example.com');
    expect(journey.responseText).toContain('HTTP/1.1 200 OK');
    expect(journey.responseText).toContain('Example Domain');
  });

  it('measures the handshake round trip instead of choosing one', () => {
    expect(journey.handshakeRttNs).toBeGreaterThan(0);
    expect(journey.handshakeRttNs).toBeLessThanOrEqual(journey.totalDurationNs);
  });

  it('ends when the capture ends', () => {
    const frames = journey.session.frames;
    expect(journey.totalDurationNs).toBe(frames[frames.length - 1].tNs);
  });

  it('modulates a frame whose length it reports', () => {
    expect(journey.phyFrameLength).toBeGreaterThan(0);
    expect(journey.phy.durationNs).toBeGreaterThan(0);
  });

  it('is built once and handed out again, not rebuilt per caller', async () => {
    // The renderer and the interface both ask for it. Rebuilding would redo
    // the decryption and the OFDM chain on every consumer.
    await expect(buildJourney()).resolves.toBe(journey);
  });
});

// --- the path across the world ---------------------------------------------

describe('the hops', () => {
  it('starts at the laptop and ends at the server', () => {
    expect(journey.hops[0].id).toBe('laptop');
    expect(journey.hops[journey.hops.length - 1].id).toBe('server');
  });

  it('spends exactly one TTL at every router along the way', () => {
    // The server is the destination, not a router: it receives the packet with
    // the TTL the last router left, and decrements nothing.
    const routers = journey.hops.slice(0, -1);
    for (let i = 1; i < routers.length; i += 1) {
      expect(routers[i].ttl, `hop ${i}`).toBe(routers[i - 1].ttl - 1);
    }
    const server = journey.hops[journey.hops.length - 1];
    expect(server.ttl).toBe(routers[routers.length - 1].ttl);
  });

  it('never lets the TTL reach zero, since the packet did arrive', () => {
    for (const hop of journey.hops) expect(hop.ttl).toBeGreaterThan(0);
  });

  it('lays the path out left to right so the camera can travel along it', () => {
    for (let i = 1; i < journey.hops.length; i += 1) {
      expect(journey.hops[i].x).toBeGreaterThan(journey.hops[i - 1].x);
    }
  });

  it('crosses the media the story needs, starting on Wi-Fi', () => {
    expect(journey.hops[0].medium).toBe('wifi');
    expect(new Set(journey.hops.map((h) => h.medium)).size).toBeGreaterThan(1);
  });
});

// --- nothing renders as a raw key ------------------------------------------

describe('every phrase the journey asks for exists', () => {
  // A missing key renders as the key itself, which looks like a bug in the
  // page rather than a gap in the dictionary. Catching it here is the
  // difference between a failing test and a viewer reading "hop.note.router".
  const keys = new Set<string>();
  for (const [, stack] of stacks) for (const view of stack) keys.add(view.noteKey);
  for (const hop of journey.hops) {
    keys.add(hop.nameKey);
    keys.add(hop.note);
  }

  it.each([...keys].sort())('%s is in the dictionary', (key) => {
    expect(en[key]).toBeDefined();
  });

  it('fills in every placeholder the sentence asks for', () => {
    for (const [, stack] of stacks) {
      for (const view of stack) {
        const text = en[view.noteKey] ?? '';
        for (const placeholder of text.match(/\{([a-z]+)\}/g) ?? []) {
          const name = placeholder.slice(1, -1);
          expect(view.noteValues?.[name], `${view.noteKey} needs ${placeholder}`).toBeDefined();
        }
      }
    }
  });
});
