/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_REPOSITORY?: string
  readonly VITE_GITHUB_BRANCH?: string
  readonly VITE_CHORDS_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}