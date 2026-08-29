/**
 * Framing, which is the one thing a screenshot cannot assert for you.
 *
 * Three.js keeps the vertical field of view fixed and lets the horizontal one
 * follow the aspect ratio. For this scene that is backwards: the stack, the
 * path across the world and the waveform all extend sideways, so a phone, where
 * the canvas is nearly square, was quietly cropping the width.
 */
import { describe, expect, it } from 'vitest';
import { DESIGN_ASPECT, DESIGN_FOV, verticalFovFor } from '../src/render/scene';

/** How wide the camera sees, as the tangent of the horizontal half-angle. */
function horizontalExtent(fov: number, aspect: number): number {
  return Math.tan((fov * Math.PI) / 360) * aspect;
}

const DESIGN_EXTENT = horizontalExtent(DESIGN_FOV, DESIGN_ASPECT);

describe('the vertical field of view', () => {
  it('is left alone at the aspect the scene was framed for', () => {
    expect(verticalFovFor(DESIGN_ASPECT)).toBe(DESIGN_FOV);
  });

  it('is left alone on anything wider, so the desktop framing never moves', () => {
    for (const aspect of [DESIGN_ASPECT, 2, 3, 21 / 9]) {
      expect(verticalFovFor(aspect), `aspect ${aspect}`).toBe(DESIGN_FOV);
    }
  });

  it('opens up on anything narrower', () => {
    for (const aspect of [1.5, 1.0, 0.8, 0.5]) {
      expect(verticalFovFor(aspect), `aspect ${aspect}`).toBeGreaterThan(DESIGN_FOV);
    }
  });

  it('holds the width of the scene still, which is the whole point', () => {
    // A phone at 375x374, a phone in landscape, a tablet, a desktop.
    for (const aspect of [375 / 374, 812 / 375, 1024 / 768, 1440 / 900, 0.6]) {
      const extent = horizontalExtent(verticalFovFor(aspect), aspect);
      expect(extent, `aspect ${aspect}`).toBeGreaterThanOrEqual(DESIGN_EXTENT - 1e-9);
    }
  });

  it('holds it exactly, not approximately, below the design aspect', () => {
    for (const aspect of [1.2, 1.0, 0.75]) {
      expect(horizontalExtent(verticalFovFor(aspect), aspect)).toBeCloseTo(DESIGN_EXTENT, 10);
    }
  });

  it('opens further the narrower the screen gets, and never the reverse', () => {
    const narrowing = [1.7, 1.4, 1.1, 0.9, 0.7];
    const fovs = narrowing.map(verticalFovFor);
    for (let i = 1; i < fovs.length; i += 1) {
      expect(fovs[i]!, `aspect ${narrowing[i]}`).toBeGreaterThan(fovs[i - 1]!);
    }
  });

  it('stays a usable angle rather than becoming one, whatever it is handed', () => {
    // A canvas can be measured as zero mid-layout, and a division by it would
    // reach the camera as NaN and blank the scene.
    for (const nonsense of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(verticalFovFor(nonsense), `${nonsense}`).toBe(DESIGN_FOV);
    }
  });

  it('never opens past a straight angle', () => {
    // Beyond 180 degrees a perspective camera stops projecting anything.
    for (const aspect of [0.5, 0.2, 0.05, 0.001]) {
      expect(verticalFovFor(aspect), `aspect ${aspect}`).toBeLessThan(180);
    }
  });
});
