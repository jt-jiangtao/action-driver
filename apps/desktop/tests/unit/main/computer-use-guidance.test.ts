import { describe, expect, it, vi } from 'vitest'
import {
  registerComputerUseGuidanceIpc,
  shouldOpenComputerUseGuidance
} from '../../../src/main/computer-use-guidance'
import { COMPUTER_GUIDANCE_ENSURE_CHANNEL } from '../../../src/shared/computer-use-contract'

const granted = { accessibility: true, screenRecording: true, eventPosting: true,
  permissionTarget: 'ActionDriver Computer Use' }

describe('Computer Use guidance', () => {
  it('opens guidance only when a required permission is missing', () => {
    expect(shouldOpenComputerUseGuidance(granted)).toBe(false)
    expect(shouldOpenComputerUseGuidance({ ...granted, accessibility: false })).toBe(true)
    expect(shouldOpenComputerUseGuidance({ ...granted, screenRecording: false })).toBe(true)
    expect(shouldOpenComputerUseGuidance({
      ...granted, accessibility: false, screenRecording: false
    })).toBe(true)
    // Input events ride on the Accessibility grant and have no row of their own.
    expect(shouldOpenComputerUseGuidance({ ...granted, eventPosting: false })).toBe(false)
    // An unreadable status proves nothing is missing, and the helper that owns the window is down.
    expect(shouldOpenComputerUseGuidance(null)).toBe(false)
  })

  it('asks the native window to present itself when guidance is needed', async () => {
    const handlers = new Map<string, (_event: unknown, input: unknown) => Promise<unknown>>()
    const present = vi.fn(async () => undefined)
    registerComputerUseGuidanceIpc(
      { handle: (channel, handler) => { handlers.set(channel, handler) } },
      { present,
        readPermissions: vi.fn(async () => ({ ...granted, accessibility: false })) }
    )

    await expect(handlers.get(COMPUTER_GUIDANCE_ENSURE_CHANNEL)!(null, {})).resolves.toBe(true)
    expect(present).toHaveBeenCalledOnce()
  })

  it('does not present anything when every permission is already granted', async () => {
    const handlers = new Map<string, (_event: unknown, input: unknown) => Promise<unknown>>()
    const present = vi.fn(async () => undefined)
    registerComputerUseGuidanceIpc(
      { handle: (channel, handler) => { handlers.set(channel, handler) } },
      { present,
        readPermissions: vi.fn(async () => granted) }
    )
    await expect(handlers.get(COMPUTER_GUIDANCE_ENSURE_CHANNEL)!(null, {})).resolves.toBe(false)
    expect(present).not.toHaveBeenCalled()
  })

  it('does not present anything when the permission status cannot be read', async () => {
    const handlers = new Map<string, (_event: unknown, input: unknown) => Promise<unknown>>()
    const present = vi.fn(async () => undefined)
    registerComputerUseGuidanceIpc(
      { handle: (channel, handler) => { handlers.set(channel, handler) } },
      { present, readPermissions: vi.fn(async () => { throw new Error('ENGINE_UNAVAILABLE') }) }
    )
    await expect(handlers.get(COMPUTER_GUIDANCE_ENSURE_CHANNEL)!(null, {})).resolves.toBe(false)
    expect(present).not.toHaveBeenCalled()
  })
})
