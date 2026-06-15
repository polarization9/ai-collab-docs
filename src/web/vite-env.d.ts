/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MARGENT_DISTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
