import { Color } from 'three';

/**
 * One colour per layer, used everywhere: the 3D strips, the hex dump, the
 * field list. Consistency is what lets someone glance at a byte and know which
 * layer put it there without reading a legend.
 */
export const LAYER_COLORS: Record<number, string> = {
  7: '#ffd166', // application, amber
  6: '#ffb4a2',
  5: '#b08bfa', // session and security, violet
  4: '#4cc9f0', // transport, cyan
  3: '#5ce08a', // network, green
  2: '#fb7185', // link, rose
  1: '#e8eefc', // physical, near white
};

export const PROTOCOL_COLORS: Record<string, string> = {
  http: LAYER_COLORS[7],
  dns: LAYER_COLORS[7],
  tls: LAYER_COLORS[5],
  tcp: LAYER_COLORS[4],
  udp: LAYER_COLORS[4],
  ipv4: LAYER_COLORS[3],
  ethernet: LAYER_COLORS[2],
  wifi: '#f472b6',
  phy: LAYER_COLORS[1],
};

export const BACKGROUND = '#05070e';
export const MUTED = '#7c8aa5';

export function colorFor(protocol: string): string {
  return PROTOCOL_COLORS[protocol] ?? MUTED;
}

export function threeColor(hex: string): Color {
  return new Color(hex);
}
