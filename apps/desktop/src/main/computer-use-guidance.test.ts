import { describe, expect, it, vi } from 'vitest'
import {
  registerComputerUseGuidanceIpc,
  shouldOpenComputerUseGuidance
} from './computer-use-guidance'
import { COMPUTER_GUIDANCE_ENSURE_CHANNEL } from '../shared/computer-use-contract'

const granted = { accessibility: true, screenRecording: true, eventPosting: true,
  permissionTarget: 'ActionDriver Computer Use' }

describe('Computer Use guidance', () => {
  it('opens guidance when a permission is missing or attribution cannot be verified', () => {
    expect(shouldOpenComputerUseGuidance({ status: granted, isPackaged: true })).toBe(false)
    expect(shouldOpenComputerUseGuidance({ status: granted, isPackaged: false })).toBe(true)
    expect(shouldOpenComputerUseGuidance({
      status: { ...granted, accessibility: false }, isPackaged: true
    })).toBe(true)
    expect(shouldOpenComputerUseGuidance({
      status: { ...granted, screenRecording: false }, isPackaged: true
    })).toBe(true)
    expect(shouldOpenComputerUseGuidance({
      status: { ...granted, eventPosting: false }, isPackaged: true
    })).toBe(false)
    expect(shouldOpenComputerUseGuidance({ status: null, isPackaged: true })).toBe(true)
  })

  it('asks the native window to present itself when guidance is needed', async () => {
    const handlers = new Map<string, (_event: unknown, input: unknown) => Promise<unknown>>()
    const present = vi.fn(async () => undefined)
    registerComputerUseGuidanceIpc(
      { handle: (channel, handler) => { handlers.set(channel, handler) } },
      { present, isPackaged: true,
        readPermissions: vi.fn(async () => ({ ...granted, accessibility: false })) }
    )

    await expect(handlers.get(COMPUTER_GUIDANCE_ENSURE_CHANNEL)!(null, {})).resolves.toBe(true)
    expect(present).toHaveBeenCalledOnce()
  })

  it('does not present anything when every permission is already granted in a packaged app', async () => {
    const handlers = new Map<string, (_event: unknown, input: unknown) => Promise<unknown>>()
    const present = vi.fn(async () => undefined)
    registerComputerUseGuidanceIpc(
      { handle: (channel, handler) => { handlers.set(channel, handler) } },
      { present, isPackaged: true,
        readPermissions: vi.fn(async () => granted) }
    )
    await expect(handlers.get(COMPUTER_GUIDANCE_ENSURE_CHANNEL)!(null, {})).resolves.toBe(false)
    expect(present).not.toHaveBeenCalled()
  })
})
