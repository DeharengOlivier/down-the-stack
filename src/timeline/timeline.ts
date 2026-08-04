import type { Journey } from '../core/scenario/journey';

/**
 * Narrative time, and its relationship to the real thing.
 *
 * The durations in this story span twelve orders of magnitude. The TLS
 * handshake takes fifteen milliseconds. One OFDM symbol takes four
 * microseconds. One bit of that symbol occupies about a sixtieth of a
 * microsecond. A single linear time axis would either spend an hour on the
 * handshake or blink through the radio layer in one frame.
 *
 * So the timeline is a list of chapters. Each has a duration in seconds of
 * screen time and covers a span of real time, and the ratio between the two is
 * that chapter's slowdown. The interface always shows both numbers, because a
 * viewer who is not told the scale changed will draw the wrong conclusions
 * about what is fast and what is slow.
 */

export type ChapterId =
  | 'press-enter'
  | 'dns-build'
  | 'dns-send'
  | 'tcp-handshake'
  | 'tls-handshake'
  | 'encapsulation'
  | 'physical'
  | 'hops'
  | 'response';

export type Station = 'stack' | 'wire' | 'air' | 'world' | 'server';

export interface Chapter {
  id: ChapterId;
  /** Seconds of screen time at normal speed. */
  duration: number;
  /** Real time this chapter covers, in nanoseconds. Zero when it covers none. */
  realSpanNs: number;
  /** Real time at which this chapter begins, in nanoseconds since the capture. */
  realStartNs: number;
  station: Station;
  /** The layer the camera is looking at, for the breadcrumb. */
  layer: number | null;
}

export interface Timeline {
  chapters: Chapter[];
  totalDuration: number;
}

export interface TimelineState {
  /** Screen seconds since the beginning. */
  t: number;
  chapterIndex: number;
  chapter: Chapter;
  /** Position inside the chapter, from 0 to 1. */
  progress: number;
  /** Real nanoseconds elapsed on the wire at this moment. */
  realNs: number;
  /**
   * How many times slower than reality this chapter runs. One million means a
   * microsecond of radio takes a second to watch.
   */
  slowdown: number;
}

/** Nanoseconds between two frames of the capture, by index. */
function span(journey: Journey, from: number, to: number): number {
  const frames = journey.session.frames;
  const a = frames[Math.min(from, frames.length - 1)]!;
  const b = frames[Math.min(to, frames.length - 1)]!;
  return Math.max(0, b.tNs - a.tNs);
}

export function buildTimeline(journey: Journey): Timeline {
  const frames = journey.session.frames;
  const lastIndex = frames.length - 1;

  const definitions: Omit<Chapter, 'realStartNs'>[] = [
    // Chapters that show construction rather than transmission cover no wire
    // time at all: nothing has been sent yet.
    { id: 'press-enter', duration: 7, realSpanNs: 0, station: 'stack', layer: 7 },
    { id: 'dns-build', duration: 11, realSpanNs: 0, station: 'stack', layer: 7 },
    { id: 'dns-send', duration: 7, realSpanNs: span(journey, 0, 1), station: 'world', layer: 3 },
    { id: 'tcp-handshake', duration: 9, realSpanNs: span(journey, 2, 4), station: 'world', layer: 4 },
    { id: 'tls-handshake', duration: 12, realSpanNs: span(journey, 5, 15), station: 'world', layer: 5 },
    { id: 'encapsulation', duration: 16, realSpanNs: 0, station: 'stack', layer: 7 },
    { id: 'physical', duration: 18, realSpanNs: journey.phy.durationNs, station: 'air', layer: 1 },
    { id: 'hops', duration: 13, realSpanNs: span(journey, 15, 16), station: 'world', layer: 3 },
    { id: 'response', duration: 11, realSpanNs: span(journey, 16, lastIndex), station: 'server', layer: 7 },
  ];

  let realCursor = 0;
  const chapters: Chapter[] = definitions.map((d) => {
    const chapter: Chapter = { ...d, realStartNs: realCursor };
    realCursor += d.realSpanNs;
    return chapter;
  });

  return { chapters, totalDuration: chapters.reduce((n, c) => n + c.duration, 0) };
}

/**
 * The whole timeline as a pure function of one number.
 *
 * No accumulated state anywhere, which is why dragging the scrubber backwards
 * costs exactly as much as playing forwards.
 */
export function stateAt(timeline: Timeline, t: number): TimelineState {
  const clamped = Math.max(0, Math.min(t, timeline.totalDuration));
  let acc = 0;
  for (let i = 0; i < timeline.chapters.length; i++) {
    const chapter = timeline.chapters[i]!;
    if (clamped < acc + chapter.duration || i === timeline.chapters.length - 1) {
      const progress = chapter.duration > 0 ? Math.min(1, (clamped - acc) / chapter.duration) : 1;
      const slowdown = chapter.realSpanNs > 0 ? (chapter.duration * 1e9) / chapter.realSpanNs : 0;
      return {
        t: clamped,
        chapterIndex: i,
        chapter,
        progress,
        realNs: chapter.realStartNs + chapter.realSpanNs * progress,
        slowdown,
      };
    }
    acc += chapter.duration;
  }
  const last = timeline.chapters[timeline.chapters.length - 1]!;
  return { t: clamped, chapterIndex: timeline.chapters.length - 1, chapter: last, progress: 1, realNs: last.realStartNs + last.realSpanNs, slowdown: 0 };
}

/** Screen time at which a chapter starts, for the scrubber's markers. */
export function chapterStart(timeline: Timeline, index: number): number {
  let acc = 0;
  for (let i = 0; i < index && i < timeline.chapters.length; i++) acc += timeline.chapters[i]!.duration;
  return acc;
}

/** Human reading of a duration given in nanoseconds. */
export function formatDuration(ns: number): string {
  if (ns === 0) return '0';
  if (ns < 1000) return `${ns.toFixed(0)} ns`;
  if (ns < 1e6) return `${(ns / 1000).toFixed(2)} µs`;
  if (ns < 1e9) return `${(ns / 1e6).toFixed(2)} ms`;
  return `${(ns / 1e9).toFixed(3)} s`;
}

/**
 * Human reading of a slowdown factor.
 *
 * Takes the translator rather than owning any wording, so the timeline stays
 * free of language.
 */
export function formatSlowdown(slowdown: number, translate: (key: string) => string): string {
  const fill = (key: string, value: string) => translate(key).replace('{n}', value);
  if (slowdown <= 0) return translate('ui.noWireTime');
  if (slowdown < 1) return fill('scale.faster', (1 / slowdown).toFixed(0));
  if (slowdown < 1000) return fill('scale.slower', slowdown.toFixed(0));
  if (slowdown < 1e6) return fill('scale.thousand', (slowdown / 1000).toFixed(0));
  return fill('scale.million', (slowdown / 1e6).toFixed(1));
}
