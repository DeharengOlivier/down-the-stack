import { describe, expect, it } from 'vitest';
import { autoplayOnLoad, shortcutFor } from '../src/ui/shortcuts';

/**
 * The timeline is the whole interface, so it has to be drivable without a
 * mouse, and it must not start moving on its own for a viewer who has asked
 * the system for less motion.
 */

const key = (init: Partial<Parameters<typeof shortcutFor>[0]>) =>
  shortcutFor({ key: ' ', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, insideTextField: false, ...init });

describe('keyboard control of the timeline', () => {
  it('plays and pauses on space', () => {
    expect(key({ key: ' ' })).toEqual({ kind: 'toggle' });
    expect(key({ key: 'k' })).toEqual({ kind: 'toggle' });
  });

  it('steps a second at a time with the arrows', () => {
    expect(key({ key: 'ArrowRight' })).toEqual({ kind: 'seek', seconds: 1 });
    expect(key({ key: 'ArrowLeft' })).toEqual({ kind: 'seek', seconds: -1 });
  });

  it('jumps a whole chapter when shift is held', () => {
    expect(key({ key: 'ArrowRight', shiftKey: true })).toEqual({ kind: 'chapter', delta: 1 });
    expect(key({ key: 'ArrowLeft', shiftKey: true })).toEqual({ kind: 'chapter', delta: -1 });
  });

  it('goes back to the beginning on Home', () => {
    expect(key({ key: 'Home' })).toEqual({ kind: 'restart' });
  });

  it('ignores a key that means nothing here', () => {
    expect(key({ key: 'q' })).toBeNull();
    expect(key({ key: 'Enter' })).toBeNull();
  });

  it('leaves the browser its own shortcuts', () => {
    // Cmd-ArrowLeft is "back" on macOS, Ctrl-K is a browser search box.
    expect(key({ key: 'ArrowLeft', metaKey: true })).toBeNull();
    expect(key({ key: 'k', ctrlKey: true })).toBeNull();
    expect(key({ key: ' ', altKey: true })).toBeNull();
  });

  it('stays out of the way while text is being typed', () => {
    // There is no text field today, but a search box added later must not
    // pause the timeline at every space.
    expect(key({ key: ' ', insideTextField: true })).toBeNull();
    expect(key({ key: 'ArrowRight', insideTextField: true })).toBeNull();
  });
});

describe('autoplay', () => {
  it('is on by default', () => {
    expect(autoplayOnLoad(() => ({ matches: false }))).toBe(true);
  });

  it('is off for a viewer who asked the system for less motion', () => {
    expect(autoplayOnLoad(() => ({ matches: true }))).toBe(false);
  });

  it('asks about reduced motion and nothing else', () => {
    const asked: string[] = [];
    autoplayOnLoad((query) => {
      asked.push(query);
      return { matches: false };
    });
    expect(asked).toEqual(['(prefers-reduced-motion: reduce)']);
  });

  it('plays when the browser cannot answer the question', () => {
    expect(autoplayOnLoad(undefined)).toBe(true);
    expect(
      autoplayOnLoad(() => {
        throw new Error('matchMedia is not a function');
      }),
    ).toBe(true);
  });
});
