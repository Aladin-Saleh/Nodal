/**
 * Déclarations minimales de d3-force-3d (le paquet ne publie pas de types),
 * limitées à ce qu'utilise la vue graphe.
 */
declare module 'd3-force-3d' {
  export interface SimulationNode {
    id: string;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface SimulationLink<N extends SimulationNode> {
    source: string | N;
    target: string | N;
  }

  export interface Force<N extends SimulationNode> {
    (alpha: number): void;
    initialize?(nodes: N[]): void;
  }

  export interface Simulation<N extends SimulationNode> {
    nodes(): N[];
    nodes(nodes: N[]): this;
    force(name: string): Force<N> | undefined;
    force(name: string, force: Force<N> | null): this;
    alpha(): number;
    alpha(alpha: number): this;
    alphaMin(min: number): this;
    alphaDecay(decay: number): this;
    velocityDecay(decay: number): this;
    restart(): this;
    stop(): this;
    tick(iterations?: number): this;
    on(type: 'tick' | 'end', listener: (() => void) | null): this;
  }

  export function forceSimulation<N extends SimulationNode>(
    nodes?: N[],
    numDimensions?: 1 | 2 | 3,
  ): Simulation<N>;

  export interface LinkForce<
    N extends SimulationNode,
    L extends SimulationLink<N>,
  > extends Force<N> {
    links(links: L[]): this;
    id(accessor: (node: N) => string): this;
    distance(distance: number | ((link: L) => number)): this;
    strength(strength: number | ((link: L) => number)): this;
  }

  export function forceLink<
    N extends SimulationNode,
    L extends SimulationLink<N>,
  >(links?: L[]): LinkForce<N, L>;

  export interface ManyBodyForce<N extends SimulationNode> extends Force<N> {
    strength(strength: number | ((node: N) => number)): this;
    distanceMax(distance: number): this;
  }

  export function forceManyBody<N extends SimulationNode>(): ManyBodyForce<N>;

  export interface CollideForce<N extends SimulationNode> extends Force<N> {
    radius(radius: number | ((node: N) => number)): this;
    strength(strength: number): this;
    iterations(iterations: number): this;
  }

  export function forceCollide<N extends SimulationNode>(
    radius?: number,
  ): CollideForce<N>;

  export function forceCenter<N extends SimulationNode>(
    x?: number,
    y?: number,
    z?: number,
  ): Force<N>;
}
