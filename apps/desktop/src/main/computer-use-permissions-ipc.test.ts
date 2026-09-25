import { describe, expect, it, vi } from 'vitest'
import { registerComputerUsePermissionsIpc } from './computer-use-permissions-ipc'
import { COMPUTER_PERMISSIONS_CHECK_CHANNEL, COMPUTER_PERMISSIONS_SETTINGS_CHANNEL } from '../shared/computer-use-contract'

describe('Computer Use permission IPC', () => {
  it('probes the helper each time and opens System Settings on request', async () => {
    const handlers = new Map<string, (_event: unknown, input: unknown) => Promise<unknown>>()
    const execute = vi.fn(async () => ({ accessibility: false, screenRecording: true,
      eventPosting: false, permissionTarget: 'ActionDriver Computer Use' }))
    const open = vi.fn(async () => undefined)
    registerComputerUsePermissionsIpc({ handle: (channel, handler) => { handlers.set(channel, handler) } },
      { execute } as never, open)
    await expect(handlers.get(COMPUTER_PERMISSIONS_CHECK_CHANNEL)!(null, {})).resolves.toMatchObject({
      accessibility: false, screenRecording: true
    })
    await handlers.get(COMPUTER_PERMISSIONS_SETTINGS_CHANNEL)!(null, {})
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ operation: 'permissions' }))
    expect(open).toHaveBeenCalledOnce()
  })
})
