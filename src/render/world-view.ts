import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import type { Hop } from '../core/scenario/journey';
import { createLabel, updateLabel } from './labels';
import { LAYER_COLORS } from './palette';
import { t } from '../content';

/**
 * The journey across the network, and the point of the whole project.
 *
 * The packet travelling here keeps its green core from one end to the other.
 * The shell around it changes colour at every single node, because the link
 * layer is rebuilt from scratch for each medium. Most textbook diagrams draw
 * one envelope crossing the whole network, which is the one thing that never
 * happens.
 */

const MEDIUM_COLORS: Record<Hop['medium'], string> = {
  wifi: '#f472b6',
  copper: '#fbbf24',
  fibre: '#38bdf8',
  backbone: '#a78bfa',
};

const FRAME_KEYS: Record<Hop['medium'], string> = {
  wifi: 'frame.wifi',
  copper: 'frame.copper',
  fibre: 'frame.fibre',
  backbone: 'frame.backbone',
};

export class WorldView {
  readonly group = new Group();
  private hops: Hop[] = [];
  private packet = new Group();
  private shell!: Mesh;
  private core!: Mesh;
  private ttlLabel = createLabel('TTL 64', { color: LAYER_COLORS[3]!, size: 34 });
  private mediumLabel = createLabel('', { color: '#e8eefc', size: 34 });

  constructor() {
    this.group.visible = false;
  }

  setHops(hops: Hop[]): void {
    this.hops = hops;
    this.group.clear();

    hops.forEach((hop, index) => {
      const isEndpoint = index === 0 || index === hops.length - 1;
      const geometry = isEndpoint
        ? new BoxGeometry(3.4, 2.2, 2.6)
        : new CylinderGeometry(1.1, 1.4, 2.2, 6);
      const material = new MeshStandardMaterial({
        color: new Color(isEndpoint ? '#dbe6ff' : '#8ea3c9'),
        emissive: new Color(isEndpoint ? '#3b5bdb' : '#1e293b'),
        emissiveIntensity: 0.45,
        roughness: 0.45,
        metalness: 0.25,
      });
      const node = new Mesh(geometry, material);
      node.position.set(hop.x, 0, 0);
      this.group.add(node);

      const label = createLabel(t(hop.nameKey), { color: '#c9d6ee', size: 34, align: 'center' });
      label.position.set(hop.x, -3.6, 0);
      label.center.set(0.5, 0.5);
      this.group.add(label);

      if (index < hops.length - 1) {
        const next = hops[index + 1]!;
        const color = MEDIUM_COLORS[hop.medium];
        const points = [new Vector3(hop.x + 1.6, 0, 0), new Vector3(next.x - 1.6, 0, 0)];
        const line = new Line(
          new BufferGeometry().setFromPoints(points),
          new LineBasicMaterial({ color: new Color(color), transparent: true, opacity: 0.55 }),
        );
        this.group.add(line);

        const mediumLabel = createLabel(t(`medium.${hop.medium}`), { color, size: 28, align: 'center' });
        mediumLabel.position.set((hop.x + next.x) / 2, 1.6, 0);
        mediumLabel.center.set(0.5, 0.5);
        this.group.add(mediumLabel);
      }
    });

    // The packet: an unchanging core inside a shell that is replaced each hop.
    this.packet = new Group();
    this.core = new Mesh(
      new CapsuleGeometry(0.42, 1.35, 4, 12),
      new MeshStandardMaterial({
        color: new Color(LAYER_COLORS[3]!),
        emissive: new Color(LAYER_COLORS[3]!),
        emissiveIntensity: 2.2,
        roughness: 0.25,
      }),
    );
    this.core.rotation.z = Math.PI / 2;
    this.core.renderOrder = 2;
    this.packet.add(this.core);

    this.shell = new Mesh(
      new CapsuleGeometry(1.05, 2.1, 4, 16),
      new MeshStandardMaterial({
        color: new Color(MEDIUM_COLORS.wifi),
        emissive: new Color(MEDIUM_COLORS.wifi),
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.26,
        roughness: 0.2,
        depthWrite: false,
      }),
    );
    this.shell.rotation.z = Math.PI / 2;
    this.shell.renderOrder = 1;
    this.packet.add(this.shell);

    this.ttlLabel.position.set(0, 2.2, 0);
    this.ttlLabel.center.set(0.5, 0.5);
    this.packet.add(this.ttlLabel);

    this.mediumLabel.position.set(0, -1.75, 0);
    this.mediumLabel.center.set(0.5, 0.5);
    this.packet.add(this.mediumLabel);

    this.group.add(this.packet);
  }

  /**
   * Moves the packet and rebuilds its shell at each node.
   *
   * `roundTrip` sends it out and brings it back, which is what a handshake
   * actually is. A one-way crossing would misrepresent three packets of
   * agreement as a single journey.
   */
  update(progress: number, roundTrip = false): void {
    if (this.hops.length < 2) return;
    const first = this.hops[0]!;
    const last = this.hops[this.hops.length - 1]!;
    const travel = roundTrip ? 1 - Math.abs(1 - progress * 2) : progress;
    const x = first.x + (last.x - first.x) * travel;
    this.packet.position.set(x, 0, 0);

    // Which link the packet is currently on.
    let index = 0;
    for (let i = 0; i < this.hops.length - 1; i++) {
      if (x >= this.hops[i]!.x) index = i;
    }
    const hop = this.hops[index]!;
    const color = new Color(MEDIUM_COLORS[hop.medium]);
    const shellMaterial = this.shell.material as MeshStandardMaterial;
    shellMaterial.color.copy(color);
    shellMaterial.emissive.copy(color);

    // A flash as the shell is discarded and written again.
    const distanceToNode = Math.abs(x - hop.x);
    const rebuilding = Math.max(0, 1 - distanceToNode / 2.5);
    shellMaterial.opacity = 0.26 - rebuilding * 0.22;
    this.shell.scale.setScalar(1 + rebuilding * 0.5);

    updateLabel(this.ttlLabel, `TTL ${hop.ttl}`, { color: LAYER_COLORS[3]!, size: 34 });
    updateLabel(this.mediumLabel, t(FRAME_KEYS[hop.medium]), {
      color: MEDIUM_COLORS[hop.medium],
      size: 34,
    });
  }

  /** Where the packet is right now, so the camera can travel with it. */
  packetX(progress: number, roundTrip = false): number {
    if (this.hops.length < 2) return 0;
    const first = this.hops[0]!;
    const last = this.hops[this.hops.length - 1]!;
    const travel = roundTrip ? 1 - Math.abs(1 - progress * 2) : progress;
    return first.x + (last.x - first.x) * travel;
  }

  /** The hop the packet is at, for the interface caption. */
  hopAt(progress: number, roundTrip = false): Hop | undefined {
    if (this.hops.length < 2) return undefined;
    const x = this.packetX(progress, roundTrip);
    let index = 0;
    for (let i = 0; i < this.hops.length - 1; i++) if (x >= this.hops[i]!.x) index = i;
    return this.hops[index];
  }

  /** Redraws the node and medium labels after a language change. */
  refreshLabels(): void {
    this.setHops(this.hops);
  }

  get centreX(): number {
    if (!this.hops.length) return 0;
    return (this.hops[0]!.x + this.hops[this.hops.length - 1]!.x) / 2;
  }
}
