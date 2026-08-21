import type { NibApi } from './index'

declare global {
  interface Window {
    /** The preload bridge. Everything that reaches disk goes through it. */
    nib: NibApi
  }
  /** Injected by electron-vite from package.json at build time. */
  const __APP_VERSION__: string
}

export {}
