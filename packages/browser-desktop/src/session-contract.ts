export type BrowserSurface = 'embedded' | 'external-chrome'
export type BrowserSessionStatus = 'running' | 'paused' | 'taken-over' | 'failed'
export type BrowserSessionActor = 'agent' | 'user'
export type BrowserSessionControl = 'pause' | 'take-over' | 'resume'

export interface BrowserTabSnapshot {
  id: string
  title: string
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserHostSnapshot {
  tabs: BrowserTabSnapshot[]
  activeTabId: string | null
}

export interface BrowserSessionSnapshot extends BrowserHostSnapshot {
  sessionId: string
  surface: BrowserSurface
  status: BrowserSessionStatus
  error: string | null
}

export type BrowserSessionCommand =
  | { type: 'create-tab' }
  | { type: 'select-tab' }
  | { type: 'close-tab' }
  | { type: 'navigate'; url: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'refresh' }
  | { type: 'click'; x: number; y: number; button?: 1 | 2 | 3 }
  | { type: 'double-click'; x: number; y: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'drag'; path: Array<{ x: number; y: number }> }
  | { type: 'keypress'; keys: string[] }
  | { type: 'type'; text: string }
  | { type: 'scroll'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'screenshot'; fullPage?: boolean;
      clip?: { x: number; y: number; width: number; height: number } }
  | { type: 'ax-state' }

export interface BrowserDesktopHostSession {
  snapshot(): Promise<BrowserHostSnapshot>
  execute(tabId: string, command: BrowserSessionCommand): Promise<unknown>
  close(): Promise<void>
}
