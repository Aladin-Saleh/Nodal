/**
 * Disposition automatique du graphe (d3-force-3d) : liens hiérarchiques
 * courts et raides, relations plus souples entre branches, répulsion
 * proportionnée au nombre d'enfants, collisions et regroupement par branche.
 * Indépendant du rendu three.js.
 */
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Force,
  type Simulation,
  type SimulationNode,
} from 'd3-force-3d';
import { NODE_RADIUS } from './node-visuals';

export interface SimNode extends SimulationNode {
  id: string;
  /** Racine de la branche (voir branchRoots). */
  branch?: string;
  /** Nombre d'enfants affichés : un parent repousse plus fort ses voisins. */
  weight?: number;
}

export interface SimLink {
  id: string;
  source: string | SimNode;
  target: string | SimNode;
  kind: 'relation' | 'hierarchy';
}

/** Disposition : longueur et raideur des liens, répulsion, regroupement. */
const HIERARCHY_DISTANCE = 32;
const RELATION_DISTANCE = 80;
const CHARGE_BASE = -90;
const CHARGE_PER_CHILD = -35;
const BRANCH_PULL = 0.08;
/** Rayon d'une branche = BRANCH_SPACING × racine cubique de son nombre de nœuds. */
const BRANCH_SPACING = 30;

const branchOf = (end: string | SimNode) =>
  typeof end === 'string' ? undefined : end.branch;

/**
 * Regroupe chaque branche et sépare les branches : chaque nœud libre est
 * attiré vers le centre de sa branche, et deux branches dont les volumes se
 * recouvrent s'écartent l'une de l'autre (rayon de chaque branche selon
 * son nombre de nœuds).
 */
function forceBranch(pull: number, spacing: number): Force<SimNode> {
  let nodes: SimNode[] = [];
  const placed = (node: SimNode) =>
    !!node.branch && node.x !== undefined && !Number.isNaN(node.x);
  const force = (alpha: number) => {
    const groups = new Map<
      string,
      { x: number; y: number; z: number; members: SimNode[] }
    >();
    for (const node of nodes) {
      if (!placed(node)) continue;
      let group = groups.get(node.branch!);
      if (!group) {
        group = { x: 0, y: 0, z: 0, members: [] };
        groups.set(node.branch!, group);
      }
      group.x += node.x!;
      group.y += node.y ?? 0;
      group.z += node.z ?? 0;
      group.members.push(node);
    }
    const centers = [...groups.values()].map((group) => {
      const n = group.members.length;
      return {
        x: group.x / n,
        y: group.y / n,
        z: group.z / n,
        members: group.members,
        radius: spacing * Math.cbrt(n),
      };
    });
    const k = pull * alpha;
    for (const center of centers) {
      if (center.members.length < 2) continue;
      for (const node of center.members) {
        node.vx = (node.vx ?? 0) + (center.x - node.x!) * k;
        node.vy = (node.vy ?? 0) + (center.y - (node.y ?? 0)) * k;
        node.vz = (node.vz ?? 0) + (center.z - (node.z ?? 0)) * k;
      }
    }
    // Écartement des branches qui se recouvrent (les nœuds isolés sont
    // laissés à la répulsion générale).
    const groupsOnly = centers.filter((center) => center.members.length > 1);
    for (let i = 0; i < groupsOnly.length; i++) {
      for (let j = i + 1; j < groupsOnly.length; j++) {
        const a = groupsOnly[i]!;
        const b = groupsOnly[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dz = b.z - a.z;
        let distance = Math.hypot(dx, dy, dz);
        const overlap = a.radius + b.radius - distance;
        if (overlap <= 0) continue;
        if (distance < 1e-6) {
          // Centres confondus : direction arbitraire mais stable.
          dx = 1;
          dy = dz = 0;
          distance = 1;
        }
        const push = (overlap / distance) * alpha * 0.5;
        for (const [group, sign] of [
          [a, -1],
          [b, 1],
        ] as const) {
          for (const node of group.members) {
            node.vx = (node.vx ?? 0) + sign * dx * push;
            node.vy = (node.vy ?? 0) + sign * dy * push;
            node.vz = (node.vz ?? 0) + sign * dz * push;
          }
        }
      }
    }
  };
  force.initialize = (next: SimNode[]) => {
    nodes = next;
  };
  return force;
}

/** Simulation arrêtée, sans nœuds : la scène lui fournit nœuds et liens. */
export function createLayoutSimulation(): Simulation<SimNode> {
  // Hiérarchie courte et raide : un enfant reste près de son parent. Une
  // relation entre deux branches tire peu, pour ne pas les mêler.
  const linkForce = forceLink<SimNode, SimLink>([])
    .id((node) => node.id)
    .distance((link) =>
      link.kind === 'hierarchy' ? HIERARCHY_DISTANCE : RELATION_DISTANCE,
    )
    .strength((link) =>
      link.kind === 'hierarchy'
        ? 0.9
        : branchOf(link.source) === branchOf(link.target)
          ? 0.4
          : 0.06,
    );
  return forceSimulation<SimNode>([], 3)
    .alphaDecay(0.03)
    .velocityDecay(0.35)
    .force(
      'charge',
      forceManyBody<SimNode>()
        .strength(
          (node) =>
            CHARGE_BASE + CHARGE_PER_CHILD * Math.sqrt(node.weight ?? 0),
        )
        .distanceMax(500),
    )
    .force('collide', forceCollide<SimNode>(NODE_RADIUS * 1.9).strength(0.9))
    .force('branch', forceBranch(BRANCH_PULL, BRANCH_SPACING))
    .force('link', linkForce);
}
