/**
 * Narrative time.
 *
 * stateAt() is a pure function of one number, and that is the property the
 * whole interface leans on: dragging the scrubber backwards costs exactly what
 * playing forwards costs, because nothing accumulates. If it ever stops being
 * pure, the symptom is a timeline that drifts the longer you scrub, which is
 * miserable to diagnose from the outside.
 *
 * The other property worth defending is monotonicity. The interface shows the
 * real elapsed time on the wire next to the screen time, and a number that
 * goes backwards while you drag forwards teaches something false.
 */
import { describe, expect, it } from 'vitest';
import { buildJourney } from '../src/core/scenario/journey';
import {
  buildTimeline,
  chapterStart,
  formatDuration,
  formatSlowdown,
  stateAt,
} from '../src/timeline/timeline';

const timeline = buildTimeline(await buildJourney());

// --- shape ------------------------------------------------------------------

describe('the timeline', () => {
  it('lasts exactly as long as its chapters put together', () => {
    const sum = timeline.chapters.reduce((n, c) => n + c.duration, 0);
    expect(timeline.totalDuration).toBe(sum);
  });

  it('gives every chapter screen time', () => {
    for (const chapter of timeline.chapters) {
      expect(chapter.duration, chapter.id).toBeGreaterThan(0);
    }
  });

  it('lays real time end to end, with no gap and no overlap', () => {
    let cursor = 0;
    for (const chapter of timeline.chapters) {
      expect(chapter.realStartNs, chapter.id).toBe(cursor);
      cursor += chapter.realSpanNs;
    }
  });

  it('covers no wire time in the chapters where nothing has been sent yet', () => {
    const building = timeline.chapters.filter((c) => c.id === 'press-enter' || c.id === 'dns-build');
    expect(building.map((c) => c.realSpanNs)).toEqual([0, 0]);
  });

  it('takes its wire time from the capture rather than from a constant', () => {
    const transmitting = timeline.chapters.filter((c) => c.realSpanNs > 0);
    expect(transmitting.length).toBeGreaterThan(2);
  });
});

// --- stateAt ----------------------------------------------------------------

describe('the state at a moment', () => {
  it('is a pure function: the same moment always gives the same answer', () => {
    const forwards = [0, 5, 20, 45, 70].map((t) => stateAt(timeline, t));
    const backwards = [70, 45, 20, 5, 0].map((t) => stateAt(timeline, t)).reverse();
    expect(backwards.map((s) => s.chapterIndex)).toEqual(forwards.map((s) => s.chapterIndex));
    expect(backwards.map((s) => s.realNs)).toEqual(forwards.map((s) => s.realNs));
    expect(backwards.map((s) => s.progress)).toEqual(forwards.map((s) => s.progress));
  });

  it('starts at the first chapter, at its very beginning', () => {
    const state = stateAt(timeline, 0);
    expect(state.chapterIndex).toBe(0);
    expect(state.progress).toBe(0);
    expect(state.realNs).toBe(0);
  });

  it('ends on the last chapter, finished', () => {
    const state = stateAt(timeline, timeline.totalDuration);
    expect(state.chapterIndex).toBe(timeline.chapters.length - 1);
    expect(state.progress).toBe(1);
  });

  it('clamps rather than falling off either end', () => {
    expect(stateAt(timeline, -100).t).toBe(0);
    expect(stateAt(timeline, timeline.totalDuration + 1000).t).toBe(timeline.totalDuration);
    expect(stateAt(timeline, Number.NEGATIVE_INFINITY).chapterIndex).toBe(0);
  });

  it('never lets real time run backwards while screen time runs forwards', () => {
    // The interface prints this number next to the scrubber.
    let previous = -1;
    for (let t = 0; t <= timeline.totalDuration; t += 0.25) {
      const state = stateAt(timeline, t);
      expect(state.realNs, `at t=${t}`).toBeGreaterThanOrEqual(previous);
      previous = state.realNs;
    }
  });

  it('keeps progress inside its chapter at every moment', () => {
    for (let t = 0; t <= timeline.totalDuration; t += 0.25) {
      const state = stateAt(timeline, t);
      expect(state.progress, `at t=${t}`).toBeGreaterThanOrEqual(0);
      expect(state.progress, `at t=${t}`).toBeLessThanOrEqual(1);
    }
  });

  it('hands a chapter boundary to the chapter that is starting', () => {
    for (let i = 0; i < timeline.chapters.length; i += 1) {
      const state = stateAt(timeline, chapterStart(timeline, i));
      expect(state.chapterIndex, `boundary ${i}`).toBe(i);
      expect(state.progress, `boundary ${i}`).toBe(0);
    }
  });

  it('reports no slowdown where there is no wire time to slow down', () => {
    for (const chapter of timeline.chapters) {
      const state = stateAt(timeline, chapterStart(timeline, timeline.chapters.indexOf(chapter)));
      if (chapter.realSpanNs === 0) expect(state.slowdown, chapter.id).toBe(0);
      else expect(state.slowdown, chapter.id).toBeGreaterThan(0);
    }
  });

  it('slows the radio layer down far more than the handshake', () => {
    // Twelve orders of magnitude is the reason the timeline exists at all: a
    // single linear axis would blink through the physical layer entirely.
    const at = (id: string) =>
      stateAt(timeline, chapterStart(timeline, timeline.chapters.findIndex((c) => c.id === id)) + 0.1);
    expect(at('physical').slowdown).toBeGreaterThan(at('tls-handshake').slowdown * 100);
  });
});

// --- chapterStart -----------------------------------------------------------

describe('where a chapter starts', () => {
  it('is zero for the first', () => {
    expect(chapterStart(timeline, 0)).toBe(0);
  });

  it('adds up to the whole timeline for one past the last', () => {
    expect(chapterStart(timeline, timeline.chapters.length)).toBe(timeline.totalDuration);
  });

  it('increases with every chapter', () => {
    for (let i = 1; i <= timeline.chapters.length; i += 1) {
      expect(chapterStart(timeline, i)).toBeGreaterThan(chapterStart(timeline, i - 1));
    }
  });
});

// --- the two formatters -----------------------------------------------------

describe('reading a duration', () => {
  it.each([
    [0, '0'],
    [1, '1 ns'],
    [999, '999 ns'],
    [1000, '1.00 µs'],
    [1500, '1.50 µs'],
    [1e6, '1.00 ms'],
    [1e9, '1.000 s'],
    [4000, '4.00 µs'],
  ])('%i nanoseconds reads as %s', (ns, expected) => {
    expect(formatDuration(ns)).toBe(expected);
  });

  it('changes unit exactly at the thousand, not around it', () => {
    expect(formatDuration(999)).toContain('ns');
    expect(formatDuration(1000)).toContain('µs');
    expect(formatDuration(999999)).toContain('µs');
    expect(formatDuration(1e6)).toContain('ms');
  });
});

describe('reading a slowdown', () => {
  const translate = (key: string) => `${key}:{n}`;

  it('says outright when there is no wire time at all', () => {
    expect(formatSlowdown(0, translate)).toBe('ui.noWireTime:{n}');
    expect(formatSlowdown(-1, translate)).toBe('ui.noWireTime:{n}');
  });

  it('picks the scale that keeps the number readable', () => {
    expect(formatSlowdown(0.5, translate)).toBe('scale.faster:2');
    expect(formatSlowdown(60, translate)).toBe('scale.slower:60');
    expect(formatSlowdown(5000, translate)).toBe('scale.thousand:5');
    expect(formatSlowdown(2.5e6, translate)).toBe('scale.million:2.5');
  });

  it('owns no wording of its own, so the timeline stays free of language', () => {
    // Every branch goes through the translator it was handed.
    for (const slowdown of [0, 0.5, 60, 5000, 2.5e6]) {
      expect(formatSlowdown(slowdown, () => 'X{n}')).toContain('X');
    }
  });
});
