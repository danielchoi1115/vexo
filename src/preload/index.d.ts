import type { VexoApi } from '../shared/types'

declare global {
  interface Window {
    api: VexoApi
  }
}

export {}
