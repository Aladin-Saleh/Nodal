import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Content-Security-Policy stricte, injectée uniquement au build : en
 * développement, le preamble inline de plugin-react et le WebSocket HMR de
 * Vite ne sont pas compatibles avec cette politique.
 *
 * Styles en ligne autorisés : CodeMirror et Mermaid injectent leurs styles
 * dans des balises <style>. Le risque reste limité : aucun script en ligne
 * ni eval (script-src 'self'), et du CSS injecté ne peut rien exfiltrer
 * puisque images, polices et connexions sont restreintes à l'application.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'nodal:csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: CONTENT_SECURITY_POLICY,
        },
        injectTo: 'head-prepend',
      },
    ],
  };
}

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
});
