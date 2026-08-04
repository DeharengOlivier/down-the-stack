import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial } from 'three';

/**
 * Text in the 3D scene, drawn to a canvas and shown as a sprite.
 *
 * Sprites always face the camera, which is what we want for labels: a label
 * that rotates with the scene becomes unreadable the moment the camera moves.
 */

export interface LabelOptions {
  size?: number;
  color?: string;
  weight?: number;
  align?: CanvasTextAlign;
  /** Height of the sprite in world units. */
  worldHeight?: number;
}

const DPR = 2;

export function createLabel(text: string, options: LabelOptions = {}): Sprite {
  const size = options.size ?? 44;
  const color = options.color ?? '#e8eefc';
  const weight = options.weight ?? 500;
  const worldHeight = options.worldHeight ?? 1.1;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `${weight} ${size}px "SF Mono", ui-monospace, "JetBrains Mono", Menlo, monospace`;
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const width = Math.max(8, Math.ceil(metrics.width) + 24);
  const height = Math.ceil(size * 1.5);

  canvas.width = width * DPR;
  canvas.height = height * DPR;
  ctx.scale(DPR, DPR);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = options.align ?? 'left';
  ctx.fillStyle = color;
  ctx.fillText(text, options.align === 'center' ? width / 2 : 12, height / 2);

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;

  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set((width / height) * worldHeight, worldHeight, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** Replaces a label's text in place, reusing the sprite. */
export function updateLabel(sprite: Sprite, text: string, options: LabelOptions = {}): void {
  const next = createLabel(text, options);
  const material = sprite.material as SpriteMaterial;
  material.map?.dispose();
  material.map = (next.material as SpriteMaterial).map;
  material.needsUpdate = true;
  sprite.scale.copy(next.scale);
  (next.material as SpriteMaterial).dispose();
}
