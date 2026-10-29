/// <reference types="vite/client" />
import type { NodalApi } from '../../shared/ipc-contract';

declare global {
  interface Window {
    /** Exposé par src/preload/index.ts via contextBridge. */
    readonly nodal: NodalApi;
  }
}
