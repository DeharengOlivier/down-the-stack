import type { Header, LayerNumber } from '../types';
import { loadSession, type CapturedFrame, type CapturedSession } from './capture';
import { CIPHER_PARAMS, decryptStream, type AnnotatedRecord } from './tls-session';
import { describeHttp } from '../protocols/http';
import { describeWifi, encodeWifi, FCS_BYTES, LLC_SNAP_BYTES, WIFI_HEADER_BYTES } from '../protocols/wifi';
import { describeRecord, describeHello, parseHandshake, parseRecords } from '../protocols/tls';
import { ETHERTYPE } from '../protocols/ethernet';
import { modulate, type OfdmResult } from '../phy/ofdm';

/**
 * Assembles everything into the single object the rest of the application
 * reads. Built once, never mutated: the renderer and the interface are pure
 * consumers, which is what makes scrubbing backwards free.
 */

export interface LayerView {
  layer: LayerNumber;
  protocol: string;
  label: string;
  /** The complete bytes as they exist at this point of the encapsulation. */
  bytes: Uint8Array;
  /** How many bytes this layer prepended. */
  headerLength: number;
  /** How many it appended, which only the frame check sequence does. */
  trailerLength: number;
  header?: Header;
  /** Content key for the sentence explaining what this layer just added. */
  noteKey: string;
  /** Values substituted into that sentence, by placeholder name. */
  noteValues?: Record<string, string | number>;
}

export interface Hop {
  id: string;
  /** Content key for the node's name. */
  nameKey: string;
  /** Position along the world axis, in scene units. */
  x: number;
  /** Link technology on the way out of this node. */
  medium: 'wifi' | 'copper' | 'fibre' | 'backbone';
  /** TTL of the packet as it leaves. */
  ttl: number;
  /** Content key for the one-line explanation of what this node does. */
  note: string;
}

export interface Journey {
  session: CapturedSession;
  /** The DNS question, built layer by layer. */
  dnsStack: LayerView[];
  /** The encrypted page request, built layer by layer. This is the centrepiece. */
  requestStack: LayerView[];
  /** The plaintext hidden inside the encrypted request. */
  requestText: string;
  responseText: string;
  clientRecords: AnnotatedRecord[];
  serverRecords: AnnotatedRecord[];
  /** The physical layer, computed on the DNS frame to keep it legible. */
  phy: OfdmResult;
  phyFrameLength: number;
  hops: Hop[];
  /** Round trip to the server, measured from the capture. */
  handshakeRttNs: number;
  totalDurationNs: number;
}

const decoder = new TextDecoder();

/** Content type, legacy version, length. The rest of the record is protected. */
const TLS_RECORD_HEADER_BYTES = 5;

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Rebuilds the descent for one captured frame.
 *
 * The bytes are the captured ones, sliced at the boundaries the parsers found,
 * so nothing here is invented. The 802.11 layer is the exception, and is marked
 * as reconstructed wherever it appears.
 */
function buildStack(frame: CapturedFrame, session: CapturedSession, topLabel: string): LayerView[] {
  const views: LayerView[] = [];
  const headers = frame.headers;
  const eth = headers[0];
  const ip = headers[1];
  const transport = headers[2];
  const application = headers[3];

  const ipStart = eth.byteLength;
  const transportStart = ipStart + ip.byteLength;
  const payloadStart = frame.payloadOffset;
  const frameEnd = ipStart + Number(ip.fields.find((f) => f.key === 'ipv4.total_length')?.value ?? 0);

  if (application) {
    const bytes = frame.bytes.slice(payloadStart, frameEnd);
    views.push({
      layer: 7,
      protocol: application.protocol,
      label: topLabel,
      bytes,
      headerLength: 0,
      trailerLength: 0,
      header: application,
      noteKey: 'layer.note.payload',
    });
  }

  if (transport) {
    const bytes = frame.bytes.slice(transportStart, frameEnd);
    views.push({
      layer: 4,
      protocol: transport.protocol,
      label: transport.protocol.toUpperCase(),
      bytes,
      headerLength: transport.byteLength,
      trailerLength: 0,
      header: transport,
      noteKey: transport.protocol === 'tcp' ? 'layer.note.tcp' : 'layer.note.udp',
    });
  }

  views.push({
    layer: 3,
    protocol: 'ipv4',
    label: 'IPv4',
    bytes: frame.bytes.slice(ipStart, frameEnd),
    headerLength: ip.byteLength,
    trailerLength: 0,
    header: ip,
    noteKey: 'layer.note.ipv4',
  });

  views.push({
    layer: 2,
    protocol: 'ethernet',
    label: 'Ethernet',
    bytes: frame.bytes.slice(0, frameEnd),
    headerLength: eth.byteLength,
    trailerLength: 0,
    header: eth,
    noteKey: 'layer.note.ethernet',
  });

  // The same packet as it really leaves a laptop on Wi-Fi.
  const ipPacket = frame.bytes.slice(ipStart, frameEnd);
  const wifiFrame = encodeWifi(
    {
      bssid: session.gatewayMac,
      source: session.clientMac,
      destination: session.gatewayMac,
      sequenceNumber: 1541,
      durationUs: 44,
      etherType: ETHERTYPE.IPV4,
    },
    ipPacket,
  );
  views.push({
    layer: 2,
    protocol: 'wifi',
    label: '802.11',
    bytes: wifiFrame,
    headerLength: WIFI_HEADER_BYTES + LLC_SNAP_BYTES,
    trailerLength: FCS_BYTES,
    header: describeWifi(wifiFrame, 0),
    noteKey: 'layer.note.wifi',
    noteValues: { n: WIFI_HEADER_BYTES + LLC_SNAP_BYTES + FCS_BYTES, eth: eth.byteLength },
  });

  return views;
}

/** The descent for the encrypted page request, which has two extra layers. */
function buildRequestStack(
  session: CapturedSession,
  record: AnnotatedRecord,
  plaintext: Uint8Array,
  carrierFrame: CapturedFrame,
): LayerView[] {
  const views: LayerView[] = [];

  views.push({
    layer: 7,
    protocol: 'http',
    label: 'HTTP request',
    bytes: plaintext,
    headerLength: 0,
    trailerLength: 0,
    header: describeHttp(plaintext, 0),
    noteKey: 'layer.note.http',
  });

  const recordBytes = concat([
    Uint8Array.from([
      record.record.contentType,
      record.record.legacyVersion >> 8,
      record.record.legacyVersion & 0xff,
      (record.record.length >> 8) & 0xff,
      record.record.length & 0xff,
    ]),
    record.record.payload,
  ]);
  // Everything the record adds after the plaintext, measured rather than
  // assumed: the sixteen byte AEAD tag, and the one byte TLS 1.3 appends to
  // the plaintext before encrypting it to carry the true record type.
  //
  // That byte is the whole trick of TLS 1.3 record framing: every record calls
  // itself "application data" on the wire, and the real type is hidden inside
  // the encryption. Declaring a flat 16 left it counted as payload, and
  // stack-view.ts draws the payload as total minus header minus trailer, so it
  // was coloured as part of the HTTP request.
  const tlsTrailerLength = recordBytes.length - TLS_RECORD_HEADER_BYTES - plaintext.length;
  views.push({
    layer: 5,
    protocol: 'tls',
    label: 'TLS 1.3 record',
    bytes: recordBytes,
    headerLength: TLS_RECORD_HEADER_BYTES,
    trailerLength: tlsTrailerLength,
    header: describeRecord(record.record),
    noteKey: 'layer.note.tls',
    noteValues: { n: recordBytes.length },
  });

  const headers = carrierFrame.headers;
  const ip = headers[1];
  const tcp = headers[2];
  const ipStart = headers[0].byteLength;
  const frameEnd = ipStart + Number(ip.fields.find((f) => f.key === 'ipv4.total_length')?.value ?? 0);

  views.push({
    layer: 4,
    protocol: 'tcp',
    label: 'TCP',
    bytes: carrierFrame.bytes.slice(ipStart + ip.byteLength, frameEnd),
    headerLength: tcp.byteLength,
    trailerLength: 0,
    header: tcp,
    noteKey: 'layer.note.tcp.request',
  });

  views.push({
    layer: 3,
    protocol: 'ipv4',
    label: 'IPv4',
    bytes: carrierFrame.bytes.slice(ipStart, frameEnd),
    headerLength: ip.byteLength,
    trailerLength: 0,
    header: ip,
    noteKey: 'layer.note.ipv4.request',
  });

  views.push({
    layer: 2,
    protocol: 'ethernet',
    label: 'Ethernet',
    bytes: carrierFrame.bytes.slice(0, frameEnd),
    headerLength: headers[0].byteLength,
    trailerLength: 0,
    header: headers[0],
    noteKey: 'layer.note.ethernet.request',
  });

  const ipPacket = carrierFrame.bytes.slice(ipStart, frameEnd);
  const wifiFrame = encodeWifi(
    {
      bssid: session.gatewayMac,
      source: session.clientMac,
      destination: session.gatewayMac,
      sequenceNumber: 1602,
      durationUs: 44,
      etherType: ETHERTYPE.IPV4,
    },
    ipPacket,
  );
  views.push({
    layer: 2,
    protocol: 'wifi',
    label: '802.11',
    bytes: wifiFrame,
    headerLength: WIFI_HEADER_BYTES + LLC_SNAP_BYTES,
    trailerLength: FCS_BYTES,
    header: describeWifi(wifiFrame, 0),
    noteKey: 'layer.note.wifi.request',
  });

  return views;
}

function buildHops(ttlOut: number, ttlBack: number): Hop[] {
  // The server almost certainly started at 64, the usual initial value, so the
  // difference is the number of routers that forwarded the reply. The capture
  // measured it rather than the simulation assuming it.
  const routersBetween = 64 - ttlBack;
  const names = [
    'hop.access-point',
    'hop.home-router',
    'hop.isp-edge',
    'hop.regional-core',
    'hop.peering',
    'hop.backbone',
    'hop.datacentre-edge',
    'hop.load-balancer',
  ];
  const media: Hop['medium'][] = ['wifi', 'copper', 'fibre', 'fibre', 'backbone', 'backbone', 'fibre', 'copper'];

  const hops: Hop[] = [
    {
      id: 'laptop',
      nameKey: 'hop.laptop',
      x: 0,
      medium: 'wifi',
      ttl: ttlOut,
      note: 'hop.note.laptop',
    },
  ];
  const count = Math.max(2, Math.min(routersBetween, names.length));
  for (let i = 0; i < count; i++) {
    hops.push({
      id: `hop-${i + 1}`,
      nameKey: names[i],
      // Spacing is tight because the camera travels with the packet rather
      // than trying to hold the whole path in one frame.
      x: 14 + i * 11,
      medium: media[i] ?? 'fibre',
      ttl: ttlOut - (i + 1),
      note: i === 0 ? 'hop.note.first' : 'hop.note.router',
    });
  }
  hops.push({
    id: 'server',
    nameKey: 'hop.server',
    x: 14 + count * 11,
    medium: 'copper',
    ttl: ttlOut - count,
    note: 'hop.note.server',
  });
  return hops;
}

let cachedJourney: Journey | null = null;

export async function buildJourney(): Promise<Journey> {
  if (cachedJourney) return cachedJourney;

  const session = loadSession();
  const cipher = CIPHER_PARAMS[0x1302];
  const clientRecords = await decryptStream(session.clientStream, session.keylog, 'client', cipher);
  const serverRecords = await decryptStream(session.serverStream, session.keylog, 'server', cipher);

  const requestRecord = clientRecords.find((r) => r.phase === 'application' && r.innerType === 23 && r.decrypted);
  const requestText = requestRecord ? decoder.decode(requestRecord.decrypted!) : '';
  const responseText = serverRecords
    .filter((r) => r.innerType === 23 && r.decrypted)
    .map((r) => decoder.decode(r.decrypted!))
    .join('');

  // The frame that carries the request record on the wire.
  const carrier =
    session.frames.find(
      (f) =>
        f.direction === 'up' &&
        f.payloadLength > 0 &&
        requestRecord !== undefined &&
        f.streamOffset !== undefined &&
        f.streamOffset <= requestRecord.record.offset &&
        requestRecord.record.offset < f.streamOffset + f.payloadLength,
    ) ?? session.frames.find((f) => f.direction === 'up' && f.payloadLength > 0)!;

  const dnsFrame = session.frames[0];
  const dnsStack = buildStack(dnsFrame, session, 'DNS question');
  const requestStack =
    requestRecord && requestRecord.decrypted
      ? buildRequestStack(session, requestRecord, requestRecord.decrypted, carrier)
      : dnsStack;

  // The physical layer runs on the DNS frame: 71 bytes is short enough that
  // every subcarrier and every symbol stays individually visible.
  const phy = modulate(dnsFrame.bytes);

  const syn = session.frames.find((f) => f.protocol === 'tcp' && f.direction === 'up')!;
  const synAck = session.frames.find((f) => f.protocol === 'tcp' && f.direction === 'down')!;
  const ttlOut = Number(syn.headers[1].fields.find((f) => f.key === 'ipv4.ttl')?.value ?? 64);
  const ttlBack = Number(synAck.headers[1].fields.find((f) => f.key === 'ipv4.ttl')?.value ?? 64);

  cachedJourney = {
    session,
    dnsStack,
    requestStack,
    requestText,
    responseText,
    clientRecords,
    serverRecords,
    phy,
    phyFrameLength: dnsFrame.bytes.length,
    hops: buildHops(ttlOut, ttlBack),
    handshakeRttNs: synAck.tNs - syn.tNs,
    totalDurationNs: session.frames[session.frames.length - 1].tNs,
  };
  return cachedJourney;
}

/** The ClientHello, described, for the chapter that shows what it reveals. */
export function clientHelloHeader(session: CapturedSession): Header | null {
  const records = parseRecords(session.clientStream);
  if (!records.length || records[0].contentType !== 22) return null;
  const [hello] = parseHandshake(records[0].payload, 0);
  return hello ? describeHello(hello) : null;
}
