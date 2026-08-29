import { BufferGeometry, Texture } from 'three';
import type { Material, Mesh, Object3D } from 'three';

/**
 * Releasing the GPU memory a subtree holds, then emptying it.
 *
 * Removing an object from its parent frees nothing: the geometry, the material
 * and the canvas texture behind a label stay uploaded until something disposes
 * them. Every view here is rebuilt during a session, so a rebuild that only
 * detaches leaks one full set of resources each time.
 */

/** Disposes a material and the textures it points at (maps, envMaps, ...). */
function disposeMaterial(material: Material): void {
  // The maps live on differently named fields depending on the material, so
  // the property list is the only complete answer.
  for (const value of Object.values(material) as unknown[]) {
    if (value instanceof Texture) value.dispose();
  }
  material.dispose();
}

/** Disposes everything under `root`, `root` included, and detaches it all. */
export function disposeSubtree(root: Object3D): void {
  root.traverse((object) => {
    const { geometry, material } = object as Partial<Mesh>;
    if (geometry instanceof BufferGeometry) geometry.dispose();
    if (!material) return;
    for (const one of Array.isArray(material) ? material : [material]) disposeMaterial(one);
  });
  root.clear();
}
