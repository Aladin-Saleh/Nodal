import { useCallback, useEffect, useState } from 'react';
import type { CodeRootInfo } from '../../../shared/code-anchors';
import { useClient } from '../../app/context';
import type { ContextMenuItem } from '../../components/ContextMenu';
import { MenuButton } from '../../components/MenuButton';
import { actionById, type AppAction } from '../commands/actions';

/** Nom d'un repo : dernière partie de son chemin. */
export const repoName = (folder: string) =>
  folder.split(/[\\/]/u).findLast(Boolean) ?? folder;

export interface ReposMenuProps {
  actions: readonly AppAction[];
  onOpenTerminalIn(folder: string): void;
}

/**
 * Menu « Repos » de la barre supérieure : les dossiers de code de l'espace,
 * relus à chaque ouverture ; en choisir un ouvre un terminal dedans.
 */
export function ReposMenu({ actions, onOpenTerminalIn }: ReposMenuProps) {
  const client = useClient();
  const [repos, setRepos] = useState<CodeRootInfo[]>([]);
  const load = useCallback(
    () => void client.call('code:getRoots').then(setRepos, () => undefined),
    [client],
  );
  useEffect(load, [load]);

  const add = actionById(actions, 'workspace.mcp');
  const settings = actionById(actions, 'workspace.settings');
  const items: ContextMenuItem[] = [
    ...(repos.length === 0
      ? [{ label: 'Aucun repo dans cet espace', disabled: true, onSelect() {} }]
      : repos.map((repo) => ({
          label: repoName(repo.path),
          title: repo.exists
            ? `${repo.path} : ouvrir un terminal dans ce repo`
            : `${repo.path} (introuvable)`,
          shortcut: repo.exists ? undefined : 'introuvable',
          disabled: !repo.exists,
          onSelect: () => onOpenTerminalIn(repo.path),
        }))),
    ...(add
      ? [{ label: 'Ajouter un repo…', separator: true, onSelect: add.run }]
      : []),
    ...(settings
      ? [{ label: 'Gérer les dossiers de code…', onSelect: settings.run }]
      : []),
  ];

  return (
    <MenuButton label="Repos" alignRight items={items} onOpen={load}>
      Repos{repos.length > 0 ? ` (${repos.length})` : ''}
    </MenuButton>
  );
}
