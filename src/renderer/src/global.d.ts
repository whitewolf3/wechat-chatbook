import type { ChatBookApi } from '../../shared/types'

declare global {
  interface Window {
    chatbook: ChatBookApi
  }
}

export {}
