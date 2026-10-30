import { describe, expect, it } from 'vitest';
import {
  createLayoutSimulation,
  type SimLink,
  type SimNode,
} from '../../src/renderer/features/graph/graph-forces';
import type { LinkForce } from 'd3-force-3d';

const centroid = (nodes: SimNode[]) => {
  const n = nodes.length;
  return {
    x: nodes.reduce((sum, node) => sum + node.x!, 0) / n,
    y: nodes.reduce((sum, node) => sum + node.y!, 0) / n,
    z: nodes.reduce((sum, node) => sum + node.z!, 0) / n,
  };
};
const distance = (a: { x: number; y: number; z: number }, b: typeof a) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('disposition par branches', () => {
  it('regroupe chaque branche et écarte les branches entremêlées au départ', () => {
    // Deux branches de 8 nœuds, alternées sur une même ligne au départ.
    const nodes: SimNode[] = Array.from({ length: 16 }, (_, i) => ({
      id: `n${i}`,
      branch: i % 2 === 0 ? 'A' : 'B',
      weight: 0,
      x: i * 4,
      y: 0,
      z: 0,
    }));
    const links: SimLink[] = nodes
      .filter((node) => node.id !== 'n0' && node.id !== 'n1')
      .map((node) => ({
        id: `h:${node.id}`,
        source: node.branch === 'A' ? 'n0' : 'n1',
        target: node.id,
        kind: 'hierarchy',
      }));
    const simulation = createLayoutSimulation().nodes(nodes);
    (simulation.force('link') as LinkForce<SimNode, SimLink>).links(links);
    simulation.tick(300);

    const a = nodes.filter((node) => node.branch === 'A');
    const b = nodes.filter((node) => node.branch === 'B');
    const spread = (group: SimNode[]) => {
      const center = centroid(group);
      return Math.max(...group.map((node) => distance(center, node as never)));
    };
    // Les deux centres sont plus éloignés que l'étendue de chaque branche.
    const gap = distance(centroid(a), centroid(b));
    expect(gap).toBeGreaterThan(spread(a));
    expect(gap).toBeGreaterThan(spread(b));
  });
});
