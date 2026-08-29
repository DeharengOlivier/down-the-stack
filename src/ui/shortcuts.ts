/**
 * Keyboard control of the timeline, and the one preference that decides
 * whether it starts moving at all.
 *
 * Both are pure functions of what the browser reports, so the mapping can be
 * tested without a DOM and without a running scene.
 */

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** What a key press means here. `null` means: not ours, leave it alone. */
export type Shortcut =
  | { kind: 'toggle' }
  | { kind: 'seek'; seconds: number }
  | { kind: 'chapter'; delta: number }
  | { kind: 'restart' };

export interface KeyPress {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** True when the press landed in an input, a textarea or a rich text field. */
  insideTextField: boolean;
}

export function shortcutFor(press: KeyPress): Shortcut | null {
  // A modifier means the press belongs to the browser or the system: Cmd-Left
  // is "back", Ctrl-K opens a search box. Shift is ours, and only on arrows.
  if (press.ctrlKey || press.metaKey || press.altKey) return null;
  if (press.insideTextField) return null;

  switch (press.key) {
    case ' ':
    case 'k':
      return { kind: 'toggle' };
    case 'ArrowRight':
      return press.shiftKey ? { kind: 'chapter', delta: 1 } : { kind: 'seek', seconds: 1 };
    case 'ArrowLeft':
      return press.shiftKey ? { kind: 'chapter', delta: -1 } : { kind: 'seek', seconds: -1 };
    case 'Home':
      return { kind: 'restart' };
    default:
      return null;
  }
}

/**
 * Whether the journey should start playing on its own.
 *
 * A viewer who has asked their system for reduced motion is handed the same
 * page, paused, with every control still there. Nothing is hidden from them.
 */
export function autoplayOnLoad(
  matchMedia: ((query: string) => { matches: boolean }) | undefined,
): boolean {
  if (!matchMedia) return true;
  try {
    return !matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    // An environment that has matchMedia but refuses this query tells us
    // nothing, and silence is not a request for less motion.
    return true;
  }
}
