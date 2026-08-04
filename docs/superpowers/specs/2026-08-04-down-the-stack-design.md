# down-the-stack: design

Date: 2026-08-04
Status: approved, in implementation

## What this is

An interactive, hyper-visual simulation that follows one real web page request from
the moment you press Enter down to the radio waveform in the air, and back up
again on the other side. Every byte shown is a real byte.

It is the first module of a wider effort: making computing legible by showing it
run rather than describing it.

## The one thing it must teach

Encapsulation. Not as a diagram of five stacked rectangles, but as a mechanism:
each layer wraps the layer above in a header it alone understands, the wrapping
is undone in reverse order at the far end, and the lower wrappings are thrown
away and rebuilt at every single hop while the payload survives untouched.

If someone finishes the journey and can explain why the IP packet is identical
at hop 4 but the frame around it is completely different, the project worked.

## Scope

In scope for this cycle:

- One scenario: loading `https://example.com/` from a laptop on Wi-Fi.
- The full path: laptop, access point, home router, ISP, core network, server.
- Layers 7 through 1, with the physical layer taken all the way to the waveform.
- Guided, scrubbable playback with inspection of any object at any moment.
- French and English.

Explicitly out of scope, and deliberately so:

- A topology editor or sandbox mode.
- Other scenarios (sending a chat message, streaming video, a DNS deep dive).
- IPv6, HTTP/2, HTTP/3, though the capture proved IPv6 is what the machine
  actually reaches for first. Worth its own module later.
- Any server side. The whole thing is static.

## Interaction model

A guided journey on a timeline the viewer controls: play, pause, scrub in both
directions, and a speed control that spans twelve orders of magnitude. The
camera travels a fixed rail with named stations. At any moment the viewer can
click any object, an object being a header, a field, a byte, or a single
modulation symbol, and get a precise explanation of what it is and why it
exists.

## Architecture

Three strictly separated layers.

### 1. `core/` — the truth

Pure TypeScript. No DOM, no WebGL, no Three.js. Runs in Node, therefore testable
without a browser.

- `bytes/` — BitWriter and BitReader, the Internet checksum of RFC 1071,
  CRC-32 for the Ethernet frame check sequence, hex formatting.
- `protocols/` — one module per protocol. Each exposes two functions:
  - `encode(fields) -> Uint8Array`, which builds the real bytes,
  - `describe(bytes) -> Field[]`, which returns every field with its bit offset,
    bit length, raw value, human reading, and explanation key.
  The `describe` output is what the byte inspector renders, so the inspector
  never hardcodes protocol knowledge.
- `phy/` — the 802.11 OFDM transmit chain: scrambler, convolutional code,
  puncturing, interleaving, QAM mapping, subcarrier allocation, inverse FFT,
  cyclic prefix, and the resulting time-domain waveform.
- `scenario/` — orchestrates the whole story and emits a `Trace`.

### 2. `timeline/` — the score

Takes the `Trace` and produces `stateAt(t) -> WorldState`, a pure function.

The hard problem here is that the durations involved span twelve orders of
magnitude: a DNS round trip is around 20 milliseconds, one OFDM symbol is 4
microseconds, and one modulation symbol carries its 6 bits in 3.2 microseconds
while a bit on a gigabit link occupies 1 nanosecond. A linear time axis is
useless.

The solution is a narrative time separate from real time. The timeline is a list
of chapters; each chapter maps a window of real time onto a window of narrative
time with its own scale factor. The interface always displays both the real
elapsed time and the current scale, so the viewer is never deceived about how
slowed down the world is.

### 3. `render/` and `ui/` — the show

`render/` is Three.js, driven imperatively, consuming `stateAt(t)` and nothing
else. `ui/` is SolidJS, whose fine-grained reactivity updates the overlay every
frame without ever re-rendering the scene.

**The 3D carries the journey, not the data.** Space, hops, the stack unfolding,
the radio wave, the constellation: three dimensions. The hex dump, the bit field
breakdown, the values: flat, typeset, overlaid. A QAM constellation in 3D is
beautiful. A byte in 3D is unreadable.

## Ground truth

The credibility of the whole project rests on this section.

A real session was captured on a real network: a real DNS query produced by
BIND's `dig`, and a real HTTPS page load performed by Node with TLS key logging
enabled. The capture yields 22 frames covering DNS resolution, the TCP
three-way handshake, a TLS 1.3 handshake whose ClientHello genuinely spans two
TCP segments, the encrypted HTTP request, the response, and the connection
teardown.

The fixture is published with the project, with the two real MAC addresses
replaced by locally administered stand-ins. MAC addresses identify physical
hardware; nothing else in the capture is personal, since the client address is
private and behind NAT.

Two independent checks:

1. **Our encoders must reproduce the capture byte for byte.** For DNS,
   Ethernet, ARP, IPv4, UDP, TCP and HTTP, the test suite asserts exact
   equality against the captured frames.
2. **tshark must agree with our field descriptions.** Wireshark's dissector is
   an independent implementation maintained by other people. The test suite
   feeds our bytes to `tshark -T json` and compares its dissection against our
   `describe()` output. Golden files are committed so the suite still runs
   where tshark is absent.

### Where we stop short, and why we say so

TLS 1.3 is not re-derived from scratch. Reproducing a handshake byte for byte
would require replaying the exact private key material and the exact extension
ordering of the client that made the capture, which teaches nothing about
encapsulation and would take longer than the rest of the project combined.

Instead: we parse the real records and handshake messages from the capture and
describe their structure field by field, and we perform **real cryptography** on
the real ciphertext. Traffic keys are derived from the captured secrets with
HKDF-Expand-Label and the AES-GCM decryption runs in WebCrypto. So the moment
where 1,400 bytes of noise turn into a readable `GET / HTTP/1.1` is not an
animation: it is an actual decryption happening in the browser.

This limit is stated in the README. A project that claims to show exactly how
things work loses everything if it is caught inventing a single byte.

### The physical layer, honestly

The deep dive models **802.11a/g OFDM at 20 MHz**: 64 subcarriers, 48 carrying
data, 4 pilots, a null at DC, a 3.2 microsecond symbol with a 0.8 microsecond
guard interval, 64-QAM at rate 3/4 for 54 Mbit/s.

This is not the Wi-Fi generation a modern laptop actually negotiates. It is the
generation whose transmit chain every later one extends rather than replaces,
and it is small enough to show every subcarrier individually on screen. The
simulation says which one it is modelling rather than implying it is showing
Wi-Fi 6.

The chain is validated by round trip, meaning the receive chain must recover the
transmitted bits exactly, and by structural invariants taken from the standard:
subcarrier count, pilot positions, symbol durations, the scrambler's 127-bit
period, and the constraint length 7 code with generator polynomials 133 and 171
in octal.

## Content and language

French and English, both first-class. Text lives in `content/fr/` and
`content/en/`, keyed by identifier, including one key per protocol field. A
`t(key)` function backed by a Solid signal, a `?lang=` parameter in the URL, no
i18n library. A key missing in one language falls back to English and logs it in
development.

## Failure handling

The application is static and offline after load, so there is no network error
handling. What can actually fail:

- **No WebGL**: detected at startup, replaced by a message and a link, not a
  blank page.
- **Weak hardware**: the frame budget is watched, and the scene degrades in a
  fixed order (waveform sample count, then instanced byte count, then
  antialiasing) before it drops frames.
- **Bad deep link**: `?t=` or `?chapter=` values outside range clamp to the
  nearest valid position instead of throwing.
- **Missing translation**: falls back to English.

## Testing

Vitest. Three families:

1. **Byte-exactness** against the captured fixture, per protocol.
2. **Cross-validation** against tshark's dissection, via committed golden files.
3. **Property tests**: the Internet checksum of a buffer with its own checksum
   inserted is zero; CRC-32 matches Node's `zlib.crc32`; the OFDM chain round
   trips; `stateAt(t)` is pure, so the same `t` always yields the same state.

## Publication

MIT for the code, CC BY-SA for the pedagogical text. Static build, deployed on
Vercel. The parent `open-source-projects/README.md` moves the project out of its
"Planned" section.
