import type cytoscape from 'cytoscape';
import { NODE_TYPES, type NodeType } from '../../../shared/domain';

/** Forme de chaque type de nœud : le type se lit aussi sans la couleur. */
export const NODE_SHAPES: Record<NodeType, cytoscape.Css.NodeShape> = {
  concept: 'ellipse',
  component: 'round-rectangle',
  data: 'barrel',
  procedure: 'cut-rectangle',
  resource: 'round-tag',
  generic: 'rectangle',
};

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/** Feuille de style Cytoscape construite à partir des variables CSS du thème. */
export function buildGraphStyle(): cytoscape.StylesheetJson {
  const text = cssVar('--text', '#1d1e22');
  const background = cssVar('--bg', '#f7f7f8');
  const muted = cssVar('--muted', '#5d6069');
  const border = cssVar('--border', '#d9dadf');
  const accent = cssVar('--accent', '#3b5bdb');

  const typeStyles: cytoscape.StylesheetJson = NODE_TYPES.map((type) => ({
    selector: `node.type-${type}`,
    style: {
      'background-color': cssVar(`--type-${type}`, '#868e96'),
      shape: NODE_SHAPES[type],
    },
  }));

  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        width: 'data(width)',
        height: 'data(height)',
        color: '#ffffff',
        'font-family': 'Segoe UI, system-ui, sans-serif',
        'font-size': 13,
        'font-weight': 600,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '190px',
        'text-outline-width': 0,
        'border-width': 1,
        'border-color': 'rgba(0, 0, 0, 0.25)',
        'transition-property': 'opacity',
        'transition-duration': 150,
      },
    },
    ...typeStyles,
    {
      selector: 'node.custom-color',
      style: { 'background-color': 'data(color)' },
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 4,
        'border-color': accent,
        'overlay-opacity': 0,
      },
    },
    {
      selector: 'edge',
      style: {
        width: 2,
        'curve-style': 'bezier',
        'line-color': muted,
        'target-arrow-color': muted,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 1.1,
        'transition-property': 'opacity',
        'transition-duration': 150,
      },
    },
    {
      selector: 'edge.relation',
      style: {
        label: 'data(label)',
        color: text,
        'font-size': 11,
        'text-rotation': 'autorotate',
        'text-background-color': background,
        'text-background-opacity': 1,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle',
      },
    },
    {
      selector: 'edge.relation.custom-color',
      style: {
        'line-color': 'data(color)',
        'target-arrow-color': 'data(color)',
      },
    },
    {
      selector: 'edge.hierarchy',
      style: {
        width: 1,
        'line-style': 'dashed',
        'line-color': border,
        'target-arrow-shape': 'none',
      },
    },
    {
      selector: 'edge:selected',
      style: { width: 3, 'line-color': accent, 'target-arrow-color': accent },
    },
    { selector: '.faded', style: { opacity: 0.35 } },
    {
      selector: 'node.link-source',
      style: {
        'border-width': 4,
        'border-style': 'dashed',
        'border-color': accent,
      },
    },
  ];
}
