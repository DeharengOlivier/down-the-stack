# down-the-stack

**One real web request, followed from the keystroke to the radio wave.**

An interactive, hyper-visual simulation of what actually happens when you load a
web page. Not a diagram of five stacked rectangles: a real captured session,
decoded byte by byte, taken all the way down to the waveform leaving the
antenna, and back up the other side.

Available in English and French.

## The one thing it teaches

Encapsulation, as a mechanism rather than a picture. Each layer wraps the layer
above in a header only it understands. The wrapping is undone in reverse order
at the far end. And the lower wrappings are thrown away and rebuilt at **every
single hop**, while the payload inside crosses radio, copper and glass without
ever being rewritten.

If you finish the journey and can explain why the IP packet is identical at hop
four but the frame around it is completely different, the project worked.

## Every byte is real

This is the part that matters, so it is worth being precise about what is
measured and what is not.

A real session was captured on a real network: a DNS query produced by BIND's
`dig`, and an HTTPS page load performed by Node with TLS key logging enabled.
The capture holds 22 frames covering DNS resolution, the TCP three-way
handshake, a TLS 1.3 handshake whose ClientHello genuinely spans two TCP
segments, the encrypted request, the response, and the teardown.

That capture ships with the project, in `fixtures/`. The two real MAC addresses
were replaced with locally administered stand-ins, because a MAC address
identifies physical hardware. Nothing else in it is personal: the client address
is private and behind NAT.

**Two independent checks keep it honest.**

1. The encoders in `src/core/protocols/` are given hand-transcribed field values
   and must reproduce the captured frames byte for byte, options, padding, DNS
   compression pointers and checksums included. See `tests/byte-exact.test.ts`.
2. The physical layer, which has no capture to compare against, must survive a
   round trip: the receive chain has to return exactly what the transmit chain
   was handed, including after bits are deliberately flipped. Its structure is
   checked against the constants in IEEE 802.11, and the CRC-32 is cross-checked
   against Node's own implementation.

### TLS is decrypted, not faked

The TLS handshake is not re-encoded from scratch. Reproducing one byte for byte
would mean replaying a specific client's private key material and its exact
extension ordering, which teaches nothing about encapsulation.

What is real: the records and handshake messages are parsed out of the captured
bytes, the traffic keys are derived from the captured secrets using the real
HKDF-Expand-Label construction of RFC 8446, and the decryption is an actual
AES-GCM operation. The moment where a wall of ciphertext becomes a readable
`GET / HTTP/1.1` is a decryption happening in your browser as you watch.

### Two places where the simulation reconstructs

Both are labelled in the interface rather than hidden.

- **The 802.11 frame.** When a laptop is on Wi-Fi, capture tools are handed an
  Ethernet-shaped frame: the driver has already stripped the radio framing.
  Seeing the real thing needs monitor mode and a second machine. So the 802.11
  frame here is built from the same payload the capture proves was sent. It is
  also shown unprotected: on a WPA network the payload carries a CCMP header and
  an integrity check and is encrypted between laptop and access point. Inventing
  that ciphertext would mean inventing a key.
- **The physical layer generation.** It models 802.11a/g OFDM at 20 MHz: 64
  subcarriers, 48 carrying data, 4 pilots, 64-QAM at rate 3/4. That is not what
  a modern laptop negotiates. It is the generation every later one extends
  rather than replaces, and it is small enough to show all 64 subcarriers at
  once.

## How it is built

Three strictly separated layers, and the separation is what makes scrubbing the
timeline backwards free.

```
src/
  core/          zero browser, zero WebGL. Runs in Node, so it can be tested.
    bytes/       BitWriter, Internet checksum, CRC-32
    protocols/   one module per protocol: encode() and describe()
    phy/         the OFDM transmit chain, scrambler through to waveform
    scenario/    reads the capture, decrypts, assembles the journey
  timeline/      chapters, time scales, stateAt(t) as a pure function
  render/        Three.js, driven imperatively, computes nothing
  ui/            SolidJS overlay: scrubber, hex inspector, explanations
  content/       en/ and fr/, one key per chapter and per protocol field
```

`core/` produces the whole journey once at load. Everything after that reads it.

### Narrative time against real time

The durations span twelve orders of magnitude: fifteen milliseconds for the TLS
handshake, four microseconds for one OFDM symbol. A single linear time axis
would be useless, so each chapter maps a window of real time onto its own window
of screen time. The interface always displays both the real elapsed time and the
current slowdown factor, because a viewer who is not told the scale changed will
draw the wrong conclusions about what is fast.

## Running it

```sh
npm install
npm run dev        # http://localhost:5180
npm test           # the byte-exactness and round-trip suites
npm run typecheck
```

To record your own capture instead of using the bundled one, on a machine where
packet capture is permitted without elevation (installing Wireshark's ChmodBPF
is enough on macOS):

```sh
npm run capture    # records a session, then filters and anonymises it
```

## Licence

MIT for the code. CC BY-SA 4.0 for the written explanations in `src/content/`.
