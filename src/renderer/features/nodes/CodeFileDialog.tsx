import { EditorState } from '@codemirror/state';
import { useEffect, useState } from 'react';
import type { CodeFileContent } from '../../../shared/code-anchors';
import type { ContentType } from '../../../shared/domain';
import { useClient } from '../../app/context';
import { describeError } from '../../services/nodal-client';
import { Modal } from '../../components/Modal';
import { CodeEditor } from '../editor/CodeEditor';

interface FileSyntax {
  contentType: ContentType;
  language: string | null;
}

const code = (language: string): FileSyntax => ({
  contentType: 'code',
  language,
});

/** Coloration d'un fichier du code d'après son extension. */
export function fileSyntax(file: string): FileSyntax {
  const extension = /\.([^./]+)$/.exec(file)?.[1]?.toLowerCase() ?? '';
  switch (extension) {
    case 'md':
    case 'markdown':
      return { contentType: 'markdown', language: null };
    case 'json':
    case 'jsonc':
      return { contentType: 'json', language: null };
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return code('typescript');
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return code('javascript');
    case 'py':
      return code('python');
    case 'java':
      return code('java');
    case 'go':
      return code('go');
    case 'sql':
      return code('sql');
    case 'yml':
    case 'yaml':
      return code('yaml');
    case 'sh':
    case 'bash':
      return code('bash');
    case 'c':
    case 'h':
      return code('c');
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
      return code('cpp');
    default:
      return { contentType: 'text', language: null };
  }
}

const readOnly = EditorState.readOnly.of(true);

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} o` : `${Math.round(bytes / 1024)} Ko`;

export interface CodeFileDialogProps {
  nodeId: string;
  /** Chemin tel qu'affiché dans « Fichiers du code ». */
  path: string;
  onClose(): void;
}

/**
 * Consultation d'un fichier ancré au nœud, en lecture seule : le contenu est
 * lu par le main dans le dossier de code, à chaque ouverture.
 */
export function CodeFileDialog({ nodeId, path, onClose }: CodeFileDialogProps) {
  const client = useClient();
  const [file, setFile] = useState<CodeFileContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.call('anchor:readFile', { nodeId, path }).then(
      (loaded) => {
        if (!cancelled) setFile(loaded);
      },
      (failure: unknown) => {
        if (!cancelled) setError(describeError(failure));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, nodeId, path]);

  const syntax = fileSyntax(path);
  return (
    <Modal
      title={path}
      size="large"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      }
    >
      <div className="code-file-view">
        {error && <p role="alert">{error}</p>}
        {!error && !file && <p className="muted">Lecture…</p>}
        {file && (
          <p className="muted">
            Lecture seule · {formatSize(file.size)}
            {file.note && ` · ${file.note}`}
          </p>
        )}
        {file?.content != null && (
          <CodeEditor
            value={file.content}
            onChange={() => {}}
            contentType={syntax.contentType}
            language={syntax.language}
            label={`Contenu de ${path}`}
            extensions={readOnly}
          />
        )}
      </div>
    </Modal>
  );
}
