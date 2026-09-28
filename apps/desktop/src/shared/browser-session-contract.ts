export const BROWSER_SESSION_COMMAND_CHANNEL = 'browser-session:command'
export const BROWSER_SESSION_EVENT_CHANNEL = 'browser-session:event'
export const BROWSER_SESSION_VIEWPORT_CHANNEL = 'browser-session:viewport'

import type {
  BrowserSessionCommand,
  BrowserSessionControl,
  BrowserSessionSnapshot,
  BrowserSurface
} from '@actiondriver/browser-desktop'

export type BrowserSessionRequest =
  | { action: 'open'; taskId: string; surface: BrowserSurface }
  | { action: 'execute'; taskId: string; sessionId: string; tabId: string;
      command: BrowserSessionCommand }
  | { action: 'transition'; taskId: string; sessionId: string;
      control: BrowserSessionControl }
  | { action: 'snapshot'; taskId: string }
  | { action: 'close'; taskId: string; sessionId: string }

export interface BrowserSessionEvent {
  taskId: string
  snapshot: BrowserSessionSnapshot | null
}

export interface BrowserViewportRequest {
  taskId: string
  sessionId: string
  bounds: { x: number; y: number; width: number; height: number }
  visible: boolean
}
