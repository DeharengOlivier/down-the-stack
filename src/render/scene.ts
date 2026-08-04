import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Journey } from '../core/scenario/journey';
import type { Station, TimelineState } from '../timeline/timeline';
import { BACKGROUND } from './palette';
import { ByteGrid, StackView } from './stack-view';
import { WorldView } from './world-view';
import { PhyView } from './phy-view';

/**
 * The renderer. It computes nothing: it is handed a timeline state and draws
 * it. Every number it uses was decided by the core, which is why dragging the
 * scrubber backwards looks identical to reaching the same moment by playing
 * forwards.
 */

interface StationPose {
  position: Vector3;
  target: Vector3;
}

export interface ByteSelection {
  /** Index of the byte inside the currently displayed layer view. */
  byteIndex: number;
}

export interface SceneHandle {
  update(state: TimelineState): void;
  resize(): void;
  render(): void;
  onSelect(handler: (selection: ByteSelection | null) => void): void;
  /** Lifts the bytes a selected field covers, so scene and panel agree. */
  highlight(byteIndices: Set<number>): void;
  /** Redraws the text baked into the scene after a language change. */
  refreshLabels(): void;
  dispose(): void;
}

export function createScene(canvas: HTMLCanvasElement, journey: Journey): SceneHandle {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(new Color(BACKGROUND), 1);

  const scene = new Scene();
  scene.fog = new Fog(new Color(BACKGROUND), 60, 190);

  const camera = new PerspectiveCamera(45, 1, 0.1, 400);
  camera.position.set(10, 2, 52);

  scene.add(new AmbientLight(0xffffff, 0.55));
  const key = new DirectionalLight(0xffffff, 1.1);
  key.position.set(18, 30, 40);
  scene.add(key);
  const rim = new PointLight(0x4c8bf0, 1.4, 220);
  rim.position.set(-30, 12, -20);
  scene.add(rim);

  const stackView = new StackView();
  const byteGrid = new ByteGrid(600);
  const worldView = new WorldView();
  const phyView = new PhyView();

  byteGrid.group.position.set(0, -12.5, 0);
  scene.add(stackView.group, byteGrid.group, worldView.group, phyView.group);

  worldView.setHops(journey.hops);
  phyView.setResult(journey.phy);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.62, 0.7, 0.22);
  composer.addPass(bloom);

  const stations: Record<Station, StationPose> = {
    stack: { position: new Vector3(0, -2, 42), target: new Vector3(0, -2, 0) },
    wire: { position: new Vector3(0, 4, 40), target: new Vector3(0, 0, 0) },
    // Shifted left so the composition lands in the space the chapter card leaves free.
    air: { position: new Vector3(-7, 0, 44), target: new Vector3(-7, 0, 0) },
    world: {
      position: new Vector3(worldView.centreX, 24, 78),
      target: new Vector3(worldView.centreX, 0, 0),
    },
    server: {
      position: new Vector3(journey.hops[journey.hops.length - 1]!.x - 6, 8, 38),
      target: new Vector3(journey.hops[journey.hops.length - 1]!.x - 6, 0, 0),
    },
  };

  const currentTarget = new Vector3().copy(stations.stack.target);
  const travelPose: StationPose = { position: new Vector3(), target: new Vector3() };
  let currentStack: 'dns' | 'request' | null = null;

  // --- picking --------------------------------------------------------------
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let selectHandler: (selection: ByteSelection | null) => void = () => {};

  function pick(event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (!byteGrid.group.visible) {
      selectHandler(null);
      return;
    }
    const hits = raycaster.intersectObject(byteGrid.mesh, false);
    const first = hits[0];
    if (first && first.instanceId !== undefined) {
      selectHandler({ byteIndex: first.instanceId });
    } else {
      selectHandler(null);
    }
  }
  canvas.addEventListener('pointerdown', pick);

  // --- per-frame ------------------------------------------------------------
  function update(state: TimelineState): void {
    const { chapter, progress } = state;

    const showStack = chapter.station === 'stack';
    const showWorld = chapter.station === 'world' || chapter.station === 'server';
    const showAir = chapter.station === 'air';

    stackView.group.visible = showStack;
    byteGrid.group.visible = showStack && chapter.id !== 'press-enter';
    worldView.group.visible = showWorld;
    phyView.group.visible = showAir;

    if (showStack) {
      const wanted = chapter.id === 'encapsulation' ? 'request' : 'dns';
      if (currentStack !== wanted) {
        stackView.setStack(wanted === 'request' ? journey.requestStack : journey.dnsStack);
        currentStack = wanted;
      }
      // The opening chapter shows exactly one strip: the thing you wanted to
      // send, before any of the machinery around it exists.
      const stackLength = (wanted === 'request' ? journey.requestStack : journey.dnsStack).length;
      const revealProgress = chapter.id === 'press-enter' ? 1 / stackLength : progress;
      stackView.update(revealProgress);

      const view = stackView.currentView(revealProgress);
      if (view) {
        const stack = wanted === 'request' ? journey.requestStack : journey.dnsStack;
        const index = stackView.focusedIndex(revealProgress);
        const inner = index > 0 ? stack[index - 1]!.protocol : view.protocol;
        byteGrid.set(view.bytes, view.headerLength, view.protocol, inner);
      }
    }

    if (showAir) phyView.update(progress);

    let pose = stations[chapter.station];
    let ease = 0.045;

    if (chapter.station === 'world') {
      // Chapters about an exchange send the packet out and bring it back; the
      // hop chapter is the only genuine one-way crossing.
      const roundTrip = chapter.id !== 'hops';
      worldView.update(progress, roundTrip);
      // The camera travels with the packet. Holding the whole path in one frame
      // would shrink every node to a dot and hide half of it behind the panels.
      const x = worldView.packetX(progress, roundTrip);
      travelPose.position.set(x, 6.5, 30);
      travelPose.target.set(x, 0, 0);
      pose = travelPose;
      ease = 0.14;
    } else if (chapter.station === 'server') {
      worldView.update(1);
    }

    // Ease towards the station rather than cutting, so the viewer keeps their
    // bearings when a chapter changes.
    camera.position.lerp(pose.position, ease);
    currentTarget.lerp(pose.target, ease);
    camera.lookAt(currentTarget);
  }

  function resize(): void {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    bloom.resolution.set(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  resize();

  return {
    update,
    resize,
    render: () => composer.render(),
    onSelect: (handler) => {
      selectHandler = handler;
    },
    highlight: (byteIndices) => byteGrid.highlight(byteIndices),
    refreshLabels: () => {
      // Scene text is drawn into textures, so a language change means redrawing
      // them. Rebuilding the physical layer view costs a few hundred vertices.
      phyView.setResult(journey.phy);
      worldView.refreshLabels();
      currentStack = null;
    },
    dispose: () => {
      canvas.removeEventListener('pointerdown', pick);
      stackView.clear();
      composer.dispose();
      renderer.dispose();
    },
  };
}
