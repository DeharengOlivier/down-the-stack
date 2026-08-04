import groundTruth from '../../../fixtures/ground-truth.json';
import { fromHex, formatIpv4, readU16, readU32 } from '../bytes/writer';
import { describeEthernet } from '../protocols/ethernet';
import { describeIpv4 } from '../protocols/ipv4';
import { describeTcp } from '../protocols/tcp';
import { describeUdp } from '../protocols/udp';
import { describeDns } from '../protocols/dns';
import type { Header } from '../types';

/**
 * Reads the captured session and turns it into something the rest of the
 * project can walk: frames with their layers already identified, and the two
 * directions of the TCP conversation reassembled into byte streams.
 */

export type Direction = 'up' | 'down';

export interface CapturedFrame {
  index: number;
  /** Nanoseconds since the first frame of the capture. */
  tNs: number;
  bytes: Uint8Array;
  direction: Direction;
  headers: Header[];
  /** Where the transport payload starts, and how long it is. */
  payloadOffset: number;
  payloadLength: number;
  protocol: 'dns' | 'tcp' | 'other';
  /** Offset of this frame's payload within its reassembled stream. */
  streamOffset?: number;
  summary: string;
}

export interface CapturedSession {
  host: string;
  serverIp: string;
  clientIp: string;
  clientMac: string;
  gatewayMac: string;
  keylog: string;
  frames: CapturedFrame[];
  /** Client to server application bytes, TCP headers removed. */
  clientStream: Uint8Array;
  serverStream: Uint8Array;
}

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

let cached: CapturedSession | null = null;

export function loadSession(): CapturedSession {
  if (cached) return cached;

  const clientIpFromFirst = (() => {
    const first = fromHex(groundTruth.frames[0]!.hex);
    return formatIpv4(first, 14 + 12);
  })();

  const frames: CapturedFrame[] = [];
  const clientParts: Uint8Array[] = [];
  const serverParts: Uint8Array[] = [];
  let clientLen = 0;
  let serverLen = 0;

  for (const raw of groundTruth.frames) {
    const bytes = fromHex(raw.hex);
    const eth = describeEthernet(bytes, 0);
    const ip = describeIpv4(bytes, 14);
    const srcIp = String(ip.fields.find((f) => f.key === 'ipv4.src')?.value ?? '');
    const direction: Direction = srcIp === clientIpFromFirst ? 'up' : 'down';
    const ipEnd = 14 + ip.byteLength;
    const protoField = ip.fields.find((f) => f.key === 'ipv4.protocol');
    const headers: Header[] = [eth, ip];

    let payloadOffset = ipEnd;
    let payloadLength = 0;
    let protocol: CapturedFrame['protocol'] = 'other';
    let streamOffset: number | undefined;
    let summary = ip.summary;

    if (protoField?.value === 17) {
      const udp = describeUdp(bytes, ipEnd);
      headers.push(udp);
      payloadOffset = ipEnd + udp.byteLength;
      payloadLength = readU16(bytes, ipEnd + 4) - 8;
      const dns = describeDns(bytes, payloadOffset);
      headers.push(dns);
      protocol = 'dns';
      summary = dns.summary;
    } else if (protoField?.value === 6) {
      const tcp = describeTcp(bytes, ipEnd);
      headers.push(tcp);
      payloadOffset = ipEnd + tcp.byteLength;
      // The IP total length is authoritative: the Ethernet frame may be padded
      // to its 60 byte minimum, and that padding is not TCP payload.
      const ipTotal = Number(ip.fields.find((f) => f.key === 'ipv4.total_length')?.value ?? 0);
      payloadLength = Math.max(0, ipTotal - ip.byteLength - tcp.byteLength);
      protocol = 'tcp';
      summary = tcp.summary;
      if (payloadLength > 0) {
        const slice = bytes.subarray(payloadOffset, payloadOffset + payloadLength);
        if (direction === 'up') {
          streamOffset = clientLen;
          clientLen += payloadLength;
          clientParts.push(slice);
        } else {
          streamOffset = serverLen;
          serverLen += payloadLength;
          serverParts.push(slice);
        }
      }
    }

    frames.push({
      index: raw.index,
      tNs: raw.tNs,
      bytes,
      direction,
      headers,
      payloadOffset,
      payloadLength,
      protocol,
      streamOffset,
      summary,
    });
  }

  const first = fromHex(groundTruth.frames[0]!.hex);
  cached = {
    host: groundTruth.host,
    serverIp: groundTruth.serverIp,
    clientIp: clientIpFromFirst,
    clientMac: [...first.subarray(6, 12)].map((b) => b.toString(16).padStart(2, '0')).join(':'),
    gatewayMac: [...first.subarray(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join(':'),
    keylog: groundTruth.keylog,
    frames,
    clientStream: concat(clientParts),
    serverStream: concat(serverParts),
  };
  return cached;
}

/** Sequence number of a TCP frame, for showing how the stream is ordered. */
export function tcpSeq(frame: CapturedFrame): number | null {
  if (frame.protocol !== 'tcp') return null;
  const ipHeader = frame.headers[1]!;
  return readU32(frame.bytes, 14 + ipHeader.byteLength + 4);
}
