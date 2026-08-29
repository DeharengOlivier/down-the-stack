import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import type { BufferGeometry } from 'three';
import type { LayerView } from '../core/scenario/journey';
import { colorFor } from './palette';
import { createLabel, updateLabel } from './labels';
import { t } from '../content';

/**
 * The encapsulation view: one horizontal strip per layer, stacked downwards.
 *
 * Strip width is proportional to the real byte count, so the growth is not a
 * metaphor. It is why the DNS question and the page request tell opposite
 * stories with the same mechanism: twenty-nine bytes of question end up inside
 * ninety-five bytes of frame, while a request large enough to fill a segment
 * barely notices the same headers being added.
 */

const STRIP_MAX_WIDTH = 30;
const STRIP_HEIGHT = 1.4;
const STRIP_DEPTH = 1.1;
const STRIP_GAP = 3;

/** Every segment mesh is built here, and always with a standard material. */
export type SegmentMesh = Mesh<BufferGeometry, MeshStandardMaterial>;

export interface StripSegment {
  mesh: SegmentMesh;
  kind: 'header' | 'payload' | 'trailer';
}

export interface Strip {
  group: Group;
  view: LayerView;
  segments: StripSegment[];
  index: number;
}

export class StackView {
  readonly group = new Group();
  private strips: Strip[] = [];
  private views: LayerView[] = [];

  constructor() {
    this.group.visible = false;
  }

  /** Rebuilds the whole view. Cheap enough to do on a chapter change. */
  setStack(views: LayerView[]): void {
    this.clear();
    this.views = views;
    const maxBytes = Math.max(...views.map((v) => v.bytes.length));

    views.forEach((view, index) => {
      const group = new Group();
      const total = view.bytes.length;
      const width = STRIP_MAX_WIDTH * (total / maxBytes);
      const unit = width / total;

      const previous = index > 0 ? views[index - 1] : undefined;
      const payloadColor = previous ? colorFor(previous.protocol) : colorFor(view.protocol);
      const headerColor = colorFor(view.protocol);

      const segments: StripSegment[] = [];
      const add = (fromByte: number, lengthBytes: number, color: string, kind: StripSegment['kind']) => {
        if (lengthBytes <= 0) return;
        const geometry = new BoxGeometry(lengthBytes * unit, STRIP_HEIGHT, STRIP_DEPTH);
        const material = new MeshStandardMaterial({
          color: new Color(color),
          emissive: new Color(color),
          emissiveIntensity: kind === 'header' ? 0.55 : 0.18,
          roughness: 0.35,
          metalness: 0.1,
          transparent: true,
          opacity: kind === 'payload' ? 0.75 : 1,
        });
        const mesh = new Mesh(geometry, material);
        mesh.position.x = -width / 2 + (fromByte + lengthBytes / 2) * unit;
        group.add(mesh);
        segments.push({ mesh, kind });
      };

      add(0, view.headerLength, headerColor, 'header');
      add(view.headerLength, total - view.headerLength - view.trailerLength, payloadColor, 'payload');
      add(total - view.trailerLength, view.trailerLength, headerColor, 'trailer');

      // Labels sit above the strip rather than beside it, so the whole
      // composition stays inside the width the side panels leave free.
      const label = createLabel(`L${view.layer}  ${view.label}`, {
        color: headerColor,
        size: 36,
        weight: 600,
        worldHeight: 0.85,
      });
      label.position.set(-width / 2, STRIP_HEIGHT / 2 + 0.62, 1.2);
      label.center.set(0, 0.5);
      group.add(label);

      const count = createLabel(
        view.headerLength > 0
          ? `${total} B   +${view.headerLength + view.trailerLength}`
          : `${total} B`,
        { color: '#9fb0cc', size: 32, worldHeight: 0.75 },
      );
      count.position.set(width / 2, STRIP_HEIGHT / 2 + 0.6, 1.2);
      count.center.set(1, 0.5);
      group.add(count);

      group.position.y = -index * STRIP_GAP;
      this.group.add(group);
      this.strips.push({ group, view, segments, index });
    });

    // Centre the whole stack vertically around the origin.
    this.group.position.y = ((views.length - 1) * STRIP_GAP) / 2;
  }

  /**
   * Reveals the strips one after another. `progress` runs from 0 to 1 across
   * the whole chapter, and each strip gets an equal slice of it.
   */
  update(progress: number): void {
    const n = this.strips.length;
    if (n === 0) return;
    const revealed = progress * n;
    this.strips.forEach((strip, i) => {
      const local = Math.max(0, Math.min(1, revealed - i));
      strip.group.visible = local > 0;
      const eased = local * local * (3 - 2 * local);
      strip.group.scale.set(eased, eased, eased);
      strip.group.position.z = (1 - eased) * -8;
      for (const segment of strip.segments) {
        segment.mesh.material.opacity = (segment.kind === 'payload' ? 0.75 : 1) * eased;
      }
    });
  }

  /** Index of the strip currently being revealed, for the interface. */
  focusedIndex(progress: number): number {
    const n = this.strips.length;
    if (n === 0) return 0;
    return Math.max(0, Math.min(n - 1, Math.floor(progress * n)));
  }

  currentView(progress: number): LayerView | undefined {
    return this.views[this.focusedIndex(progress)];
  }

  clear(): void {
    for (const strip of this.strips) {
      strip.group.traverse((child) => {
        if (isMesh(child)) {
          child.geometry.dispose();
          // Three types Mesh.material as one material or an array of them.
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) material.dispose();
        }
      });
      this.group.remove(strip.group);
    }
    this.strips = [];
  }
}

/**
 * The individual bytes of one header, as clickable cubes.
 *
 * Sixteen to a row, the way every hex dump in the world is laid out, so the
 * shape on screen matches the shape in the inspector panel beside it.
 */
export class ByteGrid {
  readonly group = new Group();
  readonly mesh: InstancedMesh;
  private count = 0;
  private rows = 1;
  private readonly capacity: number;
  private readonly dummy = new Object3D();
  private readonly caption = createLabel('', { size: 30 });

  constructor(capacity = 512) {
    this.capacity = capacity;
    const geometry = new BoxGeometry(0.78, 0.78, 0.3);
    const material = new MeshStandardMaterial({
      roughness: 0.4,
      metalness: 0.05,
      emissiveIntensity: 0.5,
      transparent: true,
    });
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.caption.center.set(0.5, 0.5);
    this.group.add(this.mesh, this.caption);
    this.group.visible = false;
  }

  /**
   * Shows the bytes this layer added, plus the first stretch of what it wrapped
   * so the boundary between the two is visible. Showing the whole frame here
   * would be a wall of identical cubes; the readable version of that lives in
   * the hex dump beside the scene.
   */
  set(bytes: Uint8Array, headerLength: number, protocol: string, payloadProtocol: string): void {
    const wanted = headerLength > 0 ? Math.min(headerLength + 16, bytes.length) : Math.min(48, bytes.length);
    const shown = Math.min(wanted, this.capacity);
    this.count = shown;
    this.mesh.count = shown;
    const headerColor = new Color(colorFor(protocol));
    const payloadColor = new Color(colorFor(payloadProtocol));
    const columns = 16;
    const rows = Math.max(1, Math.ceil(shown / columns));

    for (let i = 0; i < shown; i++) {
      const row = Math.floor(i / columns);
      const column = i % columns;
      this.dummy.position.set(
        (column - (columns - 1) / 2) * 0.92,
        -(row - (rows - 1) / 2) * 0.92,
        0,
      );
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      const base = i < headerLength ? headerColor : payloadColor;
      // Byte value modulates brightness, so the data has visible texture rather
      // than being a flat block of colour.
      const shade = 0.55 + (bytes[i] / 255) * 0.45;
      this.mesh.setColorAt(i, new Color(base.r * shade, base.g * shade, base.b * shade));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    updateLabel(
      this.caption,
      headerLength > 0
        ? t('scene.bytesAdded').replace('{n}', String(headerLength))
        : t('scene.payloadBytes').replace('{n}', String(shown)),
      { color: colorFor(protocol), size: 30 },
    );
    this.caption.position.set(0, (rows / 2) * 0.92 + 0.7, 0);
    this.rows = rows;
  }

  /** Lifts one byte forward so the selection is visible in the scene. */
  highlight(indices: Set<number>): void {
    const columns = 16;
    for (let i = 0; i < this.count; i++) {
      const row = Math.floor(i / columns);
      const column = i % columns;
      const lifted = indices.has(i);
      this.dummy.position.set(
        (column - (columns - 1) / 2) * 0.92,
        -(row - (this.rows - 1) / 2) * 0.92,
        lifted ? 0.85 : 0,
      );
      this.dummy.scale.setScalar(lifted ? 1.25 : 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.dummy.scale.setScalar(1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * `child instanceof Mesh` narrows to `Mesh<any, any, any>`: TypeScript
 * instantiates the type parameters of a generic class with `any` when it
 * narrows, so every `geometry` and `material` access behind such a check is
 * silently untyped. Three sets `isMesh` on every mesh, which gives the same
 * test while keeping the default parameters.
 */
function isMesh(object: Object3D): object is Mesh {
  return (object as Partial<Mesh>).isMesh === true;
}
