import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeNodalDatabase,
  createNodalDatabase,
} from '../../../src/main/database/connection';
import { CONTENT_TYPES, NODE_TYPES } from '../../../src/shared/domain';
import { useTempDir } from '../../helpers/temp-dir';

const tempDir = useTempDir();
const NOW = '2026-10-29T12:00:00.000Z';

let db: DatabaseSync;

beforeEach(() => {
  db = createNodalDatabase(path.join(tempDir(), 'schema.nodal'));
  insertWorkspace('w1');
  insertWorkspace('w2');
});

afterEach(() => {
  closeNodalDatabase(db);
});

function insertWorkspace(id: string) {
  db.prepare('INSERT INTO workspace VALUES (?, ?, NULL, ?, ?)').run(
    id,
    `Espace ${id}`,
    NOW,
    NOW,
  );
}

function insertNode(
  id: string,
  workspaceId = 'w1',
  options: { parentId?: string | null; nodeType?: string } = {},
) {
  db.prepare(
    `INSERT INTO node (id, workspace_id, parent_id, title, node_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    workspaceId,
    options.parentId ?? null,
    `Nœud ${id}`,
    options.nodeType ?? 'concept',
    NOW,
    NOW,
  );
}

function insertRelationType(id: string, workspaceId = 'w1', name = id) {
  db.prepare(
    'INSERT INTO relation_type (id, workspace_id, name, is_builtin) VALUES (?, ?, ?, 0)',
  ).run(id, workspaceId, name);
}

function insertEdge(
  id: string,
  source: string,
  target: string,
  relationTypeId: string,
  workspaceId = 'w1',
) {
  db.prepare(
    `INSERT INTO edge (id, workspace_id, source_node_id, target_node_id, relation_type_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, workspaceId, source, target, relationTypeId, NOW, NOW);
}

function insertDocument(
  id: string,
  nodeId: string,
  contentType = 'markdown',
  language: string | null = null,
) {
  db.prepare(
    `INSERT INTO document (id, node_id, title, content_type, language, body, created_at, updated_at)
     VALUES (?, ?, 'Doc', ?, ?, '# Titre', ?, ?)`,
  ).run(id, nodeId, contentType, language, NOW, NOW);
}

const count = (table: string) =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('node', () => {
  it('accepte exactement les six types de nœuds', () => {
    NODE_TYPES.forEach((type, index) =>
      insertNode(`n${index}`, 'w1', { nodeType: type }),
    );
    expect(count('node')).toBe(NODE_TYPES.length);
    expect(() => insertNode('bad', 'w1', { nodeType: 'service' })).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('refuse qu’un nœud soit son propre parent', () => {
    expect(() => insertNode('n1', 'w1', { parentId: 'n1' })).toThrow(
      /CHECK constraint failed/,
    );
    insertNode('n2');
    expect(() =>
      db.prepare("UPDATE node SET parent_id = 'n2' WHERE id = 'n2'").run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('refuse un parent appartenant à un autre espace', () => {
    insertNode('parent', 'w1');
    expect(() => insertNode('child', 'w2', { parentId: 'parent' })).toThrow(
      /même espace/,
    );
    insertNode('child', 'w2');
    expect(() =>
      db
        .prepare("UPDATE node SET parent_id = 'parent' WHERE id = 'child'")
        .run(),
    ).toThrow(/même espace/);
  });

  it('refuse un parent inexistant (clé étrangère)', () => {
    expect(() => insertNode('n1', 'w1', { parentId: 'ghost' })).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  it('accepte une hiérarchie dans le même espace', () => {
    insertNode('root');
    insertNode('child', 'w1', { parentId: 'root' });
    insertNode('grandchild', 'w1', { parentId: 'child' });
    expect(count('node')).toBe(3);
  });

  it('interdit de changer l’espace d’un nœud', () => {
    insertNode('n1', 'w1');
    expect(() =>
      db.prepare("UPDATE node SET workspace_id = 'w2' WHERE id = 'n1'").run(),
    ).toThrow(/ne peut pas changer/);
  });

  it('refuse de supprimer un nœud qui a des enfants', () => {
    insertNode('root');
    insertNode('child', 'w1', { parentId: 'root' });
    expect(() =>
      db.prepare("DELETE FROM node WHERE id = 'root'").run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('refuse de supprimer un nœud qui a des documents', () => {
    insertNode('n1');
    insertDocument('d1', 'n1');
    expect(() => db.prepare("DELETE FROM node WHERE id = 'n1'").run()).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    expect(count('node')).toBe(1);
    expect(count('document')).toBe(1);
  });

  it('refuse de supprimer un nœud qui a des relations', () => {
    insertNode('a');
    insertNode('b');
    insertRelationType('rt');
    insertEdge('e1', 'a', 'b', 'rt');
    expect(() => db.prepare("DELETE FROM node WHERE id = 'b'").run()).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  it('supprime en cascade uniquement les associations node_tag', () => {
    insertNode('n1');
    db.prepare(
      "INSERT INTO tag (id, workspace_id, name) VALUES ('t1', 'w1', 'infra')",
    ).run();
    db.prepare("INSERT INTO node_tag VALUES ('n1', 't1')").run();

    db.prepare("DELETE FROM node WHERE id = 'n1'").run();

    expect(count('node_tag')).toBe(0);
    expect(count('tag')).toBe(1);
  });
});

describe('document', () => {
  it('accepte exactement les cinq types de contenu', () => {
    insertNode('n1');
    CONTENT_TYPES.forEach((type, index) =>
      insertDocument(`d${index}`, 'n1', type),
    );
    expect(count('document')).toBe(CONTENT_TYPES.length);
    expect(() => insertDocument('bad', 'n1', 'html')).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('réserve le champ language aux documents de code', () => {
    insertNode('n1');
    insertDocument('code', 'n1', 'code', 'typescript');
    expect(() => insertDocument('md', 'n1', 'markdown', 'typescript')).toThrow(
      /CHECK constraint failed/,
    );
  });
});

describe('edge', () => {
  beforeEach(() => {
    insertNode('a1', 'w1');
    insertNode('b1', 'w1');
    insertNode('a2', 'w2');
    insertRelationType('rt1', 'w1');
    insertRelationType('rt2', 'w2');
  });

  it('relie deux nœuds du même espace', () => {
    insertEdge('e1', 'a1', 'b1', 'rt1');
    expect(count('edge')).toBe(1);
  });

  it('refuse une relation entre deux espaces différents', () => {
    expect(() => insertEdge('e1', 'a1', 'a2', 'rt1')).toThrow(/même espace/);
    expect(() => insertEdge('e2', 'a2', 'a1', 'rt1')).toThrow(/même espace/);
  });

  it('refuse un type de relation d’un autre espace', () => {
    expect(() => insertEdge('e1', 'a1', 'b1', 'rt2')).toThrow(/même espace/);
  });

  it('refuse de déplacer une extrémité vers un autre espace', () => {
    insertEdge('e1', 'a1', 'b1', 'rt1');
    expect(() =>
      db.prepare("UPDATE edge SET target_node_id = 'a2' WHERE id = 'e1'").run(),
    ).toThrow(/même espace/);
  });

  it('refuse de supprimer un type de relation utilisé', () => {
    insertEdge('e1', 'a1', 'b1', 'rt1');
    expect(() =>
      db.prepare("DELETE FROM relation_type WHERE id = 'rt1'").run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe('relation_type', () => {
  it('impose un nom unique par espace, sans tenir compte de la casse', () => {
    insertRelationType('rt1', 'w1', 'Utilise');
    expect(() => insertRelationType('rt2', 'w1', 'utilise')).toThrow(
      /UNIQUE constraint failed/,
    );
    insertRelationType('rt3', 'w2', 'utilise');
    expect(count('relation_type')).toBe(2);
  });
});

describe('node_tag', () => {
  it('refuse d’associer un tag d’un autre espace', () => {
    insertNode('n1', 'w1');
    db.prepare(
      "INSERT INTO tag (id, workspace_id, name) VALUES ('t2', 'w2', 'x')",
    ).run();
    expect(() =>
      db.prepare("INSERT INTO node_tag VALUES ('n1', 't2')").run(),
    ).toThrow(/même espace/);
  });
});

const insertAttachment = (
  id: string,
  data: Uint8Array,
  target: { nodeId?: string | null; documentId?: string | null },
  sizeBytes = data.byteLength,
) =>
  db
    .prepare(
      `INSERT INTO attachment (id, node_id, document_id, file_name, data, mime_type, size_bytes, checksum, created_at)
       VALUES (?, ?, ?, 'schema.png', ?, 'image/png', ?, ?, ?)`,
    )
    .run(
      id,
      target.nodeId ?? null,
      target.documentId ?? null,
      data,
      sizeBytes,
      createHash('sha256').update(data).digest('hex'),
      NOW,
    );

describe('attachment', () => {
  it('conserve un BLOB à l’identique (round-trip)', () => {
    insertNode('n1');
    const data = randomBytes(256 * 1024);
    insertAttachment('a1', data, { nodeId: 'n1' });

    const row = db
      .prepare('SELECT data, size_bytes, checksum FROM attachment WHERE id = ?')
      .get('a1') as { data: Uint8Array; size_bytes: number; checksum: string };

    expect(Buffer.from(row.data).equals(data)).toBe(true);
    expect(row.size_bytes).toBe(data.byteLength);
    expect(createHash('sha256').update(row.data).digest('hex')).toBe(
      row.checksum,
    );
  });

  it('exige un nœud ou un document de rattachement', () => {
    expect(() => insertAttachment('a1', randomBytes(8), {})).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('refuse une taille déclarée incohérente', () => {
    insertNode('n1');
    expect(() =>
      insertAttachment('a1', randomBytes(8), { nodeId: 'n1' }, 9),
    ).toThrow(/CHECK constraint failed/);
  });

  it('refuse de supprimer un document qui a des pièces jointes', () => {
    insertNode('n1');
    insertDocument('d1', 'n1');
    insertAttachment('a1', randomBytes(8), { documentId: 'd1' });
    expect(() =>
      db.prepare("DELETE FROM document WHERE id = 'd1'").run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});
