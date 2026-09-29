import { describe, expect, it, vi } from 'vitest'
import { registerComputerUsePermissionsIpc } from '../../../src/main/computer-use-permissions-ipc'
import { COMPUTER_PERMISSIONS_CHECK_CHANNEL, COMPUTER_PERMISSIONS_SETTINGS_CHANNEL } from '../../../src/shared/computer-use-contract'

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

  it('forwards the authorization prompt flag so the system can register the app', async () => {
    const handlers = new Map<string, (_event: unknown, input: unknown) => Promise<unknown>>()
    const execute = vi.fn(async () => ({ accessibility: false, screenRecording: false,
      eventPosting: false, permissionTarget: 'ActionDriver Computer Use' }))
    registerComputerUsePermissionsIpc({ handle: (channel, handler) => { handlers.set(channel, handler) } },
      { execute } as never, async () => undefined)

    await handlers.get(COMPUTER_PERMISSIONS_CHECK_CHANNEL)!(null,
      { prompt: true, target: 'accessibility' })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ prompt: true, target: 'accessibility' }))

    execute.mockClear()
    await handlers.get(COMPUTER_PERMISSIONS_CHECK_CHANNEL)!(null,
      { prompt: true, target: 'microphone' })
    expect(execute).toHaveBeenCalledWith(expect.not.objectContaining({ target: expect.anything() }))

    execute.mockClear()
    await handlers.get(COMPUTER_PERMISSIONS_CHECK_CHANNEL)!(null, {})
    expect(execute).toHaveBeenCalledWith(expect.not.objectContaining({ prompt: true }))
  })
})
