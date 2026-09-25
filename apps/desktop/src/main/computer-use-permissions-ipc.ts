import type { ComputerUseClient } from './computer-use-client'
import {
  COMPUTER_PERMISSIONS_CHECK_CHANNEL,
  COMPUTER_PERMISSIONS_SETTINGS_CHANNEL,
  type ComputerPermissionStatus
} from '../shared/computer-use-contract'

export function registerComputerUsePermissionsIpc(
  ipc: { handle(channel: string, handler: (_event: unknown, input: unknown) => Promise<unknown>): void },
  client: ComputerUseClient | null,
  openSystemSettings: () => Promise<void>
): void {
  ipc.handle(COMPUTER_PERMISSIONS_CHECK_CHANNEL, async () => {
    if (!client) throw new Error('ENGINE_UNAVAILABLE: Computer Use helper is missing')
    const result = await client.execute({ version: 1, requestId: crypto.randomUUID(),
      deadlineUnixMs: Date.now() + 10_000, operation: 'permissions' })
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
}
