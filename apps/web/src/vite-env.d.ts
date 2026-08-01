/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Hôte du serveur PartyKit (mode en ligne). Défini au build. */
  readonly VITE_PARTYKIT_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
