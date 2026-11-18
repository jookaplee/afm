/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" for the standalone build (in-browser database, no server). */
  readonly VITE_STANDALONE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
