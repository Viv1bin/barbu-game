/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Hôte du serveur temps réel Cloudflare Workers (mode en ligne). Défini au build. */
  readonly VITE_PARTYKIT_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
