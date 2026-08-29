# Security

This project is a static page. It has no server of its own, no account, no
credential, no cookie and no storage: everything it shows is computed in your
browser from files that ship with it. Once the page has loaded, it makes no
network request at all, to anybody.

The interesting question here is not what the application could do to you. It
is what the published capture says about the network it was recorded on.

## What is published, and what it exposes

`fixtures/ground-truth.pcap` and `fixtures/ground-truth.json` are a real
capture of a real session: a DNS query for `example.com` and the HTTPS page
load that followed it, twenty-two frames in all.

- **The hardware addresses are not real.** A MAC address identifies a physical
  network card, so the two that appear were replaced with locally administered
  stand-ins by `scripts/extract.mjs`.
- **The client address is not real either.** It is `192.168.1.100`, a stand-in
  written over the private address that was actually there, with the IP header
  and the TCP and UDP checksums that covered it recomputed from the rewritten
  bytes. A private address identifies nothing outside the flat it was captured
  in, and this one was not even in it.
- **There is no wall clock.** The frames keep their intervals, which is what
  the simulation reads, but they are pinned to a neutral instant rather than
  to the evening the capture was taken.
- **The other endpoints are public services**, contacted by anybody who
  resolves and loads that page. They are left as they are: hiding a DNS
  resolver and a web server would only make the capture less checkable.

`fixtures/session.keylog` ships too, and that is deliberate: the decryption you
watch in the interface is a real AES-GCM operation on the real ciphertext, and
it needs the real secrets. What that file holds is the TLS 1.3 traffic secrets
of this one session, which were negotiated for it and expired with it. It holds
no long-term private key, and it can decrypt nothing else, including any other
session with the same server.

None of that is asserted here and left at that: `tests/published-capture.test.ts`
checks it against the files in the repository, on every run. If somebody ever
replaces the fixture with a capture that still carries a manufacturer-assigned
MAC address, a private address that was not rewritten, a real capture time, or
a key log covering more than the shipped session, the suite fails.

## What is deliberately not published

`fixtures/session.pcap` and `fixtures/session.meta.json` are the raw recording,
before filtering and anonymisation. They hold whatever else the machine was
doing at that moment and the real hardware addresses. They are in `.gitignore`
and must stay there.

## If you record your own capture

`npm run capture` records a session on your own machine and then filters and
anonymises it. Two things are worth knowing before you run it:

- It captures everything on the interface for the duration, not only the
  session it sets up. The raw file is the one listed above, and it is ignored by
  git for exactly this reason.
- The anonymisation replaces the MAC addresses it finds. It does not, and
  cannot, know that a hostname, a certificate or a cookie in your own traffic
  identifies you. If you intend to publish a capture of your own, read it first.

## Parsing a capture is parsing untrusted input

Every decoder in `src/core/protocols/` reads a length or an offset out of the
bytes it was handed. A truncated or malformed frame used to walk off the end of
the buffer and produce `undefined` in the middle of a field description;
`requireBytes` in `src/core/bytes/writer.ts` now refuses the read instead, with
a message naming the protocol and the byte count it needed. That is covered by
`tests/short-buffers.test.ts`.

The application never builds HTML from those bytes: the interface renders text
nodes, and the 3D scene draws geometry. There is no `innerHTML`, no `eval`, and
no dynamic import anywhere in `src/`.

## Dependencies

`npm audit` runs in CI on every push and every pull request, and a high or
critical advisory fails the build. The project ships a static bundle with no
runtime backend, so a moderate advisory in a build tool is reported but does not
gate a merge.

## Reporting something

Open an issue at
<https://github.com/DeharengOlivier/down-the-stack/issues>. Nothing here holds
anybody else's data or credentials, so there is no embargo process: a public
issue is the right place.
