// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PathPanel } from '../../src/renderer/features/graph/PathPanel';
import type { PathStep } from '../../src/shared/graph-path';
import type { EdgeInfo, RelationTypeInfo } from '../../src/shared/model';

afterEach(cleanup);

const titles: Record<string, string> = { a: 'API', b: 'Cache', c: 'Redis' };
const edges = [
  {
    id: 'e1',
    sourceId: 'a',
    targetId: 'b',
    relationTypeId: 'r1',
    label: 'lit',
  },
] as EdgeInfo[];
const relationTypes = [{ id: 'r1', name: 'utilise' }] as RelationTypeInfo[];
const steps: PathStep[] = [
  { nodeId: 'a', via: null },
  {
    nodeId: 'b',
    via: {
      kind: 'relation',
      edgeId: 'e1',
      relationTypeId: 'r1',
      forward: true,
    },
  },
  { nodeId: 'c', via: { kind: 'child' } },
];

function renderPanel(props: Partial<Parameters<typeof PathPanel>[0]> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onIncludeHierarchyChange: vi.fn(),
  };
  render(
    <PathPanel
      fromTitle="API"
      toTitle="Redis"
      steps={steps}
      routes={1}
      maxDepth={12}
      includeHierarchy
      titleOf={(id) => titles[id]!}
      edges={edges}
      relationTypes={relationTypes}
      hiddenCount={0}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('PathPanel', () => {
  it('liste les étapes avec le type et le sens de chaque lien', () => {
    const { onSelect, onClose } = renderPanel({ hiddenCount: 1 });
    expect(screen.getByRole('status').textContent).toBe('2 liens');
    expect(screen.getByText('→ utilise (lit)')).toBeTruthy();
    expect(screen.getByText('↓ enfant')).toBeTruthy();
    expect(screen.getByText(/1 nœud du chemin est masqué/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cache' }));
    expect(onSelect).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByRole('button', { name: 'Fermer le chemin' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('dit clairement qu’il n’y a aucun chemin, et propose la hiérarchie', () => {
    const { onIncludeHierarchyChange } = renderPanel({
      steps: null,
      includeHierarchy: false,
    });
    expect(screen.getByRole('status').textContent).toContain(
      'Aucun chemin entre « API » et « Redis » en 12 liens au plus',
    );
    expect(screen.getByRole('status').textContent).toContain('hiérarchie');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onIncludeHierarchyChange).toHaveBeenCalledWith(true);
  });
});
