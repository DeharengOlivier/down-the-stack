import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three';
import type { OfdmResult } from '../core/phy/ofdm';
import { DATA_INDICES, FFT_SIZE, PILOT_INDICES } from '../core/phy/ofdm';
import { createLabel } from './labels';
import { t } from '../content';

/**
 * The physical layer, in four movements.
 *
 * Bits, then constellation points, then the frequencies they ride on, then the
 * single wave that is the sum of all of them. Each is shown in the place where
 * it is legible: the constellation is a plane because it is a plane, and the
 * waveform is a line because it is a function of time.
 */

const BIT_COLOR = '#e8eefc';
const PILOT_COLOR = '#fbbf24';
const DATA_COLOR = '#4cc9f0';

export interface PhyStage {
  key: string;
  from: number;
  to: number;
}

/** Where each stage sits in the chapter, as fractions of its progress. */
export const PHY_STAGES: PhyStage[] = [
  { key: 'phy.scramble', from: 0, to: 0.16 },
  { key: 'phy.encode', from: 0.16, to: 0.32 },
  { key: 'phy.interleave', from: 0.32, to: 0.46 },
  { key: 'phy.map', from: 0.46, to: 0.64 },
  { key: 'phy.subcarriers', from: 0.64, to: 0.82 },
  { key: 'phy.ifft', from: 0.82, to: 1 },
];

export function stageAt(progress: number): PhyStage {
  return PHY_STAGES.find((s) => progress < s.to) ?? PHY_STAGES[PHY_STAGES.length - 1]!;
}

export class PhyView {
  readonly group = new Group();
  private bits!: InstancedMesh;
  private bitCount = 0;
  private constellation!: InstancedMesh;
  private constellationCount = 0;
  private subcarriers!: InstancedMesh;
  private waveform!: Line;
  private waveSamples: Vector3[] = [];
  private readonly dummy = new Object3D();
  private groups: Record<string, Group> = {};

  constructor() {
    this.group.visible = false;
  }

  setResult(result: OfdmResult): void {
    this.group.clear();
    this.groups = {};

    this.buildBits(result);
    this.buildConstellation(result);
    this.buildSubcarriers(result);
    this.buildWaveform(result);
  }

  private section(name: string, y: number, x = 0, title = ''): Group {
    const group = new Group();
    group.position.set(x, y, 0);
    if (title) {
      const label = createLabel(title, { color: '#8ea3c9', size: 30, align: 'center' });
      label.position.set(0, 6.4, 0);
      label.center.set(0.5, 0.5);
      group.add(label);
    }
    this.group.add(group);
    this.groups[name] = group;
    return group;
  }

  private buildBits(result: OfdmResult): void {
    const group = this.section('bits', 10, 0, t('scene.bits'));
    const columns = 96;
    const shown = Math.min(result.punctured.length, columns * 8);
    this.bitCount = shown;
    const geometry = new BoxGeometry(0.16, 0.5, 0.16);
    const material = new MeshStandardMaterial({
      color: new Color(BIT_COLOR),
      emissive: new Color(BIT_COLOR),
      emissiveIntensity: 0.9,
      transparent: true,
    });
    this.bits = new InstancedMesh(geometry, material, shown);
    this.bits.frustumCulled = false;
    for (let i = 0; i < shown; i++) {
      const row = Math.floor(i / columns);
      const column = i % columns;
      const on = result.punctured[i] === 1;
      this.dummy.position.set((column - columns / 2) * 0.26, -row * 0.7, 0);
      this.dummy.scale.set(1, on ? 1 : 0.28, 1);
      this.dummy.updateMatrix();
      this.bits.setMatrixAt(i, this.dummy.matrix);
      const shade = on ? 1 : 0.3;
      this.bits.setColorAt(i, new Color(shade, shade, shade));
    }
    this.dummy.scale.set(1, 1, 1);
    this.bits.instanceMatrix.needsUpdate = true;
    group.add(this.bits);
  }

  private buildConstellation(result: OfdmResult): void {
    const group = this.section('constellation', 0, -13, t('scene.constellation'));
    const points = result.symbols[0]?.constellation ?? [];
    this.constellationCount = points.length;

    // Axes, so the plane reads as a plane rather than a scatter of dots.
    const axisMaterial = new LineBasicMaterial({ color: new Color('#243247') });
    group.add(
      new Line(
        new BufferGeometry().setFromPoints([new Vector3(-4.9, 0, 0), new Vector3(4.9, 0, 0)]),
        axisMaterial,
      ),
    );
    group.add(
      new Line(
        new BufferGeometry().setFromPoints([new Vector3(0, -4.9, 0), new Vector3(0, 4.9, 0)]),
        axisMaterial,
      ),
    );

    const geometry = new SphereGeometry(0.16, 12, 12);
    const material = new MeshStandardMaterial({
      color: new Color(DATA_COLOR),
      emissive: new Color(DATA_COLOR),
      emissiveIntensity: 1.4,
      transparent: true,
    });
    this.constellation = new InstancedMesh(geometry, material, Math.max(1, points.length));
    this.constellation.frustumCulled = false;
    points.forEach((point, i) => {
      // Amplitudes run to seven over the square root of forty-two, so scale to
      // fill the axes.
      this.dummy.position.set(point.re * 3.9, point.im * 3.9, 0);
      this.dummy.updateMatrix();
      this.constellation.setMatrixAt(i, this.dummy.matrix);
    });
    this.constellation.instanceMatrix.needsUpdate = true;
    group.add(this.constellation);
  }

  private buildSubcarriers(result: OfdmResult): void {
    const group = this.section('subcarriers', 0, 13, t('scene.subcarriers'));
    const spectrum = result.symbols[0]?.spectrum ?? [];
    const geometry = new BoxGeometry(0.28, 1, 0.28);
    const material = new MeshStandardMaterial({
      emissiveIntensity: 0.9,
      transparent: true,
      roughness: 0.3,
    });
    this.subcarriers = new InstancedMesh(geometry, material, FFT_SIZE);
    this.subcarriers.frustumCulled = false;

    for (let bin = 0; bin < FFT_SIZE; bin++) {
      const k = bin < FFT_SIZE / 2 ? bin : bin - FFT_SIZE; // -32..31
      const value = spectrum[bin] ?? { re: 0, im: 0 };
      const magnitude = Math.hypot(value.re, value.im);
      const height = Math.max(0.02, magnitude * 3.4);
      this.dummy.position.set(k * 0.17, height / 2 - 2, 0);
      this.dummy.scale.set(1, height, 1);
      this.dummy.updateMatrix();
      this.subcarriers.setMatrixAt(bin, this.dummy.matrix);
      const isPilot = (PILOT_INDICES as readonly number[]).includes(k);
      const isData = DATA_INDICES.includes(k);
      const color = new Color(isPilot ? PILOT_COLOR : isData ? DATA_COLOR : '#1e293b');
      this.subcarriers.setColorAt(bin, color);
    }
    this.dummy.scale.set(1, 1, 1);
    this.subcarriers.instanceMatrix.needsUpdate = true;
    group.add(this.subcarriers);
  }

  private buildWaveform(result: OfdmResult): void {
    const group = this.section('waveform', -9.5, 0, t('scene.waveform'));
    const samples = result.symbols.flatMap((s) => s.samples);
    const span = 46;
    this.waveSamples = samples.map((s, i) => new Vector3(-span / 2 + (i / Math.max(1, samples.length - 1)) * span, s.re * 9, 0));

    const geometry = new BufferGeometry().setFromPoints(this.waveSamples);
    this.waveform = new Line(
      geometry,
      new LineBasicMaterial({ color: new Color('#7dd3fc'), transparent: true }),
    );
    group.add(this.waveform);

    // Mark each symbol boundary so the four microsecond grid is visible.
    const perSymbol = samples.length / Math.max(1, result.symbols.length);
    for (let s = 0; s <= result.symbols.length; s++) {
      const x = -span / 2 + ((s * perSymbol) / Math.max(1, samples.length - 1)) * span;
      const marker = new Mesh(
        new BoxGeometry(0.04, 5.4, 0.04),
        new MeshStandardMaterial({ color: new Color('#1e293b'), transparent: true, opacity: 0.8 }),
      );
      marker.position.set(x, 0, -0.1);
      group.add(marker);
    }
  }

  /** Brings each stage in as the chapter advances. */
  update(progress: number): void {
    const reveal = (name: string, from: number, to: number) => {
      const group = this.groups[name];
      if (!group) return;
      const local = Math.max(0, Math.min(1, (progress - from) / (to - from)));
      group.visible = local > 0;
      const eased = local * local * (3 - 2 * local);
      group.scale.setScalar(0.6 + eased * 0.4);
      group.traverse((child) => {
        const material = (child as Mesh).material as MeshStandardMaterial | undefined;
        if (material && 'opacity' in material) {
          material.transparent = true;
          material.opacity = eased;
        }
      });
    };

    reveal('bits', 0, 0.3);
    reveal('constellation', 0.42, 0.66);
    reveal('subcarriers', 0.6, 0.84);
    reveal('waveform', 0.78, 1);

    // The wave draws itself left to right over the last stretch.
    //
    // Through the draw range rather than by rebuilding the geometry: once a
    // BufferGeometry has a position attribute, setFromPoints reuses it and
    // iterates over its original length, so handing it a shorter array reads
    // past the end of that array.
    if (this.waveform && this.waveSamples.length) {
      const drawn = Math.max(2, Math.floor(((progress - 0.78) / 0.22) * this.waveSamples.length));
      this.waveform.geometry.setDrawRange(0, Math.min(drawn, this.waveSamples.length));
    }

    // The bits light up progressively during the coding stages.
    if (this.bits) {
      const lit = Math.floor(Math.min(1, progress / 0.42) * this.bitCount);
      (this.bits.material as MeshStandardMaterial).opacity = 1;
      this.bits.count = Math.max(1, lit);
    }
    if (this.constellation) {
      const lit = Math.floor(Math.max(0, Math.min(1, (progress - 0.42) / 0.2)) * this.constellationCount);
      this.constellation.count = Math.max(0, lit);
    }
  }
}
