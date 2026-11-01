import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { CaptureApp } from './features/capture/CaptureApp';
import { createNodalClient } from './services/nodal-client';
import './theme.css';
import './index.css';
import './workspace.css';
import './graph.css';
import './polish.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Élément #root introuvable dans index.html');
}

const client = createNodalClient(window.nodal);
// Même renderer pour la fenêtre de capture rapide (#capture).
createRoot(container).render(
  <StrictMode>
    {window.location.hash === '#capture' ? (
      <CaptureApp client={client} />
    ) : (
      <App client={client} />
    )}
  </StrictMode>,
);
