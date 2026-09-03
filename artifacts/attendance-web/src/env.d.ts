/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RAPIDAPI_KEY: string;
  readonly NEXT_PUBLIC_RAPIDAPI_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
