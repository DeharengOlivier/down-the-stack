import { beforeAll, describe, expect, it } from 'vitest';
import { BufferGeometry, Material, Object3D, Texture } from 'three';
import type { Mesh } from 'three';
import { ByteGrid, StackView } from '../src/render/stack-view';
import { disposeSubtree } from '../src/render/dispose';
import { WorldView } from '../src/render/world-view';
import { PhyView } from '../src/render/phy-view';
import { buildJourney } from '../src/core/scenario/journey';

/**
 * Removing an object from its parent frees nothing. The geometry, the
 * material and the canvas texture behind every label stay uploaded to the GPU
 * until something disposes them, and each view here is rebuilt many times in
 * one session: the stack on every move between the DNS chapter and the
 * encapsulation chapter, the world and the physical layer on every language
 * change.
 *
 * A probe against the running application (Chrome DevTools Protocol, counting
 * WebGL createTexture minus deleteTexture) measured about four textures leaked
 * per stack rebuild, growing linearly: 78 over 20 rebuilds, 238 over 60.
 */

// The label sprites are drawn on a 2D canvas, which node does not have.
beforeAll(() => {
  const context = {
    font: '',
    textBaseline: '' as CanvasTextBaseline,
    textAlign: '' as CanvasTextAlign,
    fillStyle: '',
    scale: () => undefined,
    fillText: () => undefined,
    measureText: (text: string) => ({ width: text.length * 9 }),
  };
  const documentStub = {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  };
  (globalThis as { document?: unknown }).document ??= documentStub;
});

interface Held {
  geometries: Set<BufferGeometry>;
  materials: Set<Material>;
  textures: Set<Texture>;
}

/** Everything in this subtree that owns GPU memory. */
function held(root: Object3D): Held {
  const result: Held = { geometries: new Set(), materials: new Set(), textures: new Set() };
  root.traverse((object) => {
    const { geometry, material } = object as Partial<Mesh>;
    if (geometry instanceof BufferGeometry) result.geometries.add(geometry);
    const materials = Array.isArray(material) ? material : material ? [material] : [];
    for (const one of materials) {
      result.materials.add(one);
      for (const value of Object.values(one) as unknown[]) {
        if (value instanceof Texture) result.textures.add(value);
      }
    }
  });
  return result;
}

/** Records which of them get disposed, by listening for three's own event. */
function watch(resources: Held): { undisposed: () => string[] } {
  const alive = new Map<object, string>();
  const track = (kind: string, one: BufferGeometry | Material | Texture) => {
    const name = `${kind} ${one.constructor.name} ${one.uuid.slice(0, 8)}`;
    alive.set(one, name);
    one.addEventListener('dispose', () => alive.delete(one));
  };
  for (const geometry of resources.geometries) track('geometry', geometry);
  for (const material of resources.materials) track('material', material);
  for (const texture of resources.textures) track('texture', texture);
  return { undisposed: () => [...alive.values()].sort() };
}

const journey = await buildJourney();

describe('the encapsulation view', () => {
  it('holds a texture per label, so there is something to leak', () => {
    const view = new StackView();
    view.setStack(journey.requestStack);
    const resources = held(view.group);
    expect(resources.textures.size).toBeGreaterThan(0);
    expect(resources.materials.size).toBeGreaterThan(resources.textures.size);
  });

  it('releases every geometry, material and texture when it is cleared', () => {
    const view = new StackView();
    view.setStack(journey.requestStack);
    const watcher = watch(held(view.group));
    view.clear();
    expect(watcher.undisposed()).toEqual([]);
  });

  it('releases the previous stack when it is handed a new one', () => {
    const view = new StackView();
    view.setStack(journey.dnsStack);
    const watcher = watch(held(view.group));
    view.setStack(journey.requestStack);
    expect(watcher.undisposed()).toEqual([]);
  });

  it('leaves nothing behind in the scene graph either', () => {
    const view = new StackView();
    view.setStack(journey.requestStack);
    view.clear();
    expect(view.group.children).toEqual([]);
  });
});

describe('the world view', () => {
  it('releases the previous network when the labels are refreshed', () => {
    const view = new WorldView();
    view.setHops(journey.hops);
    const watcher = watch(held(view.group));
    view.refreshLabels();
    expect(watcher.undisposed()).toEqual([]);
  });

  it('still draws the whole network after a refresh', () => {
    const view = new WorldView();
    view.setHops(journey.hops);
    const before = held(view.group);
    view.refreshLabels();
    const after = held(view.group);
    expect(after.geometries.size).toBe(before.geometries.size);
    expect(after.textures.size).toBe(before.textures.size);
  });
});

describe('the physical layer view', () => {
  it('releases the previous waveform when it is given a new result', () => {
    const view = new PhyView();
    view.setResult(journey.phy);
    const watcher = watch(held(view.group));
    view.setResult(journey.phy);
    expect(watcher.undisposed()).toEqual([]);
  });

  it('still draws every section after a rebuild', () => {
    const view = new PhyView();
    view.setResult(journey.phy);
    const before = held(view.group);
    view.setResult(journey.phy);
    expect(held(view.group).geometries.size).toBe(before.geometries.size);
  });
});

describe('the byte grid', () => {
  it('is released by the helper the scene tears down with', () => {
    const grid = new ByteGrid(64);
    const watcher = watch(held(grid.group));
    disposeSubtree(grid.group);
    expect(watcher.undisposed()).toEqual([]);
    expect(grid.group.children).toEqual([]);
  });
});
