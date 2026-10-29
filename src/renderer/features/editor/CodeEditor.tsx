import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import type { ContentType } from '../../../shared/domain';

/** Coloration selon le type de document et, pour le code, le langage (§6.4). */
export function languageExtension(
  contentType: ContentType,
  language: string | null,
): Extension {
  switch (contentType) {
    case 'markdown':
      return markdown();
    case 'json':
      return json();
    case 'text':
    case 'mermaid':
      return [];
    case 'code':
      switch (language) {
        case 'java':
          return java();
        case 'javascript':
          return javascript();
        case 'typescript':
          return javascript({ typescript: true });
        case 'python':
          return python();
        case 'sql':
          return sql();
        case 'go':
          return go();
        case 'json':
          return json();
        case 'yaml':
          return yaml();
        case 'bash':
          return StreamLanguage.define(shell);
        case 'c':
        case 'cpp':
          return cpp();
        default:
          return [];
      }
  }
}

const prefersDark = () =>
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

export interface CodeEditorProps {
  value: string;
  onChange(value: string): void;
  contentType: ContentType;
  language: string | null;
  /** Étiquette accessible de la zone d'édition. */
  label: string;
}

/**
 * Éditeur CodeMirror 6 : coloration syntaxique, numéros de ligne,
 * indentation, historique. Le contenu est du texte inerte : rien n'est
 * exécuté. `value` sert de valeur initiale ; une valeur différente reçue
 * ensuite (ex. mise en forme JSON) remplace le contenu.
 */
export function CodeEditor({
  value,
  onChange,
  contentType,
  language,
  label,
}: CodeEditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const languageSlot = useRef(new Compartment());
  const themeSlot = useRef(new Compartment());
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!container.current) return;
    const wraps = contentType === 'markdown' || contentType === 'text';
    const editor = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          languageSlot.current.of(languageExtension(contentType, language)),
          themeSlot.current.of(prefersDark() ? oneDark : []),
          wraps ? EditorView.lineWrapping : [],
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    view.current = editor;

    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onTheme = () =>
      editor.dispatch({
        effects: themeSlot.current.reconfigure(prefersDark() ? oneDark : []),
      });
    media?.addEventListener('change', onTheme);
    return () => {
      media?.removeEventListener('change', onTheme);
      editor.destroy();
      view.current = null;
    };
    // L'éditeur est créé une fois ; le langage et la valeur sont suivis à part.
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({
      effects: languageSlot.current.reconfigure(
        languageExtension(contentType, language),
      ),
    });
  }, [contentType, language]);

  // Valeur imposée de l'extérieur (ex. mise en forme JSON).
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current !== value) {
      editor.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return <div ref={container} className="code-editor" />;
}
