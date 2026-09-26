import type { ComputerUseClient } from './computer-use-client'
import {
  COMPUTER_APP_ICON_CHANNEL,
  COMPUTER_PERMISSIONS_CHECK_CHANNEL,
  COMPUTER_PERMISSIONS_SETTINGS_CHANNEL,
  type ComputerPermissionStatus
} from '../shared/computer-use-contract'
import { app } from 'electron'

export function registerComputerUsePermissionsIpc(
  ipc: { handle(channel: string, handler: (_event: unknown, input: unknown) => Promise<unknown>): void },
  client: ComputerUseClient | null,
  openSystemSettings: () => Promise<void>
): void {
  ipc.handle(COMPUTER_PERMISSIONS_CHECK_CHANNEL, async (_event, input) => {
    if (!client) throw new Error('ENGINE_UNAVAILABLE: Computer Use helper is missing')
    const request = (input ?? {}) as { prompt?: unknown; target?: unknown }
    const prompt = request.prompt === true
    const target = prompt && ['accessibility', 'screenRecording', 'eventPosting']
      .includes(String(request.target)) ? String(request.target) as 'accessibility' | 'screenRecording' | 'eventPosting'
      : undefined
    const result = await client.execute({ version: 1, requestId: crypto.randomUUID(),
      deadlineUnixMs: Date.now() + 30_000, operation: 'permissions',
      ...(prompt ? { prompt: true } : {}), ...(target ? { target } : {}) })
    if (typeof result !== 'object' || result === null) throw new Error('INVALID_PERMISSIONS_RESPONSE')
    const status = result as Partial<ComputerPermissionStatus>
    if (typeof status.accessibility !== 'boolean' || typeof status.screenRecording !== 'boolean' ||
        typeof status.eventPosting !== 'boolean' || typeof status.permissionTarget !== 'string')
      throw new Error('INVALID_PERMISSIONS_RESPONSE')
    return status as ComputerPermissionStatus
  })
  ipc.handle(COMPUTER_PERMISSIONS_SETTINGS_CHANNEL, async () => {
    await openSystemSettings()
  })
  // The approval card shows the real application icon; the runtime already sends the app path.
  ipc.handle(COMPUTER_APP_ICON_CHANNEL, async (_event, input) => {
    const { appPath } = (input ?? {}) as { appPath?: unknown }
    if (typeof appPath !== 'string' || !appPath.endsWith('.app')) return null
    try {
      const icon = await app.getFileIcon(appPath, { size: 'small' })
      return icon.isEmpty() ? null : icon.toDataURL()
    } catch {
      return null
    }
  })
}
