export interface DiscoveredApp {
  appPath?: string | null
  bundleIdentifier?: string
  displayName?: string
  isFrontmost?: boolean
  isRunning?: boolean
  lastUsedDate?: string | null
  useCount?: number | null
}
export interface AppPolicyResult {
  allowPersistentApproval: boolean
  decision: 'allowed' | 'denied' | 'forbidden'
  target: {
    appPath: string
    bundleIdentifier: string
    displayName: string
    risk: 'high' | 'low'
    warningSubtitle?: string | null
  }
}
export interface WindowAppState {
  app: string | { bundleIdentifier?: string; pid?: number }
  appSpecificInstructions?: string | null
  skyshot?: { text: string; screenshot?: { url?: string | null; mimeType?: string | null } | null }
}
export interface AudioResult {
  url?: string | null
}
