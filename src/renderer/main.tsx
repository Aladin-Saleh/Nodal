import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createNodalClient } from './services/nodal-client';
import './index.css';
import './workspace.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Élément #root introuvable dans index.html');
}

createRoot(container).render(
  <StrictMode>
    <App client={createNodalClient(window.nodal)} />
  </StrictMode>,
);
