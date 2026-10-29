import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import {
  createMarkdownRenderer,
  isExternalLink,
  nodeLinkTitle,
} from './markdown';

/** Ouverture d'un nœud depuis un lien interne [[Titre]]. */
export const NodeLinkContext = createContext<(title: string) => void>(
  () => undefined,
);

const markdownRenderer = createMarkdownRenderer();

/**
 * Aperçu Markdown. Le HTML produit vient de markdown-it avec le HTML brut
 * désactivé : le contenu de l'utilisateur est toujours échappé.
 */
export function MarkdownPreview({ source }: { source: string }) {
  const openNode = useContext(NodeLinkContext);
  const html = useMemo(() => markdownRenderer.render(source), [source]);

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href') ?? '';
    const title = nodeLinkTitle(href);
    if (title) openNode(title);
    // Le main ouvre les liens web dans le navigateur du système.
    else if (isExternalLink(href)) window.open(href);
  };

  return (
    <div
      className="markdown-preview"
      onClick={onClick}
      // oxlint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

type MermaidApi = typeof import('mermaid').default;
let mermaidLoader: Promise<MermaidApi> | null = null;

/** Mermaid est volumineux : chargé à la première utilisation seulement. */
function loadMermaid(): Promise<MermaidApi> {
  mermaidLoader ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      // Aucun script, lien cliquable ni ressource distante dans les diagrammes.
      securityLevel: 'strict',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      // Thème clair : l'aperçu est toujours affiché sur fond blanc.
      theme: 'default',
    });
    return mermaid;
  });
  return mermaidLoader;
}

const RENDER_DELAY_MS = 300;

/**
 * Rendu local d'un diagramme Mermaid (§6.5). Le SVG est affiché comme une
 * image : aucun script ne peut s'y exécuter et la CSP de l'application reste
 * stricte. Une erreur de syntaxe est affichée sans interrompre l'édition.
 */
export function MermaidPreview({ source }: { source: string }) {
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Dernier rendu valide : conservé tant qu'un nouveau rendu n'a pas réussi.
  const currentUrl = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (source.trim() === '') {
        setImage(null);
        setError(null);
        return;
      }
      const id = `mermaid-${baseId}-${Date.now()}`;
      loadMermaid()
        .then((mermaid) => mermaid.render(id, source))
        .then(({ svg }) => {
          if (cancelled) return;
          const url = URL.createObjectURL(
            new Blob([svg], { type: 'image/svg+xml' }),
          );
          if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
          currentUrl.current = url;
          setImage(url);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          // Mermaid laisse parfois un conteneur temporaire dans la page.
          document.getElementById(`d${id}`)?.remove();
          document.getElementById(id)?.remove();
        });
    }, RENDER_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, baseId]);

  return (
    <div className="mermaid-preview">
      {error && (
        <p className="warning" role="status">
          Diagramme invalide : {error}
        </p>
      )}
      {image ? (
        <img src={image} alt="Rendu du diagramme Mermaid" />
      ) : (
        !error && <p className="muted">Aperçu du diagramme…</p>
      )}
    </div>
  );
}
