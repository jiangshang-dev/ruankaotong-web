import type { RuankaoApi } from './index'

declare global {
  interface Window {
    api: RuankaoApi
  }
}

export {}
