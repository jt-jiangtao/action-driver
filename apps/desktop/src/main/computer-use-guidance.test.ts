import { describe, expect, it, vi } from 'vitest'
import {
  computerUseGuidanceUrl,
  computerUseGuidanceWindowOptions,
  registerComputerUseGuidanceIpc,
  shouldOpenComputerUseGuidance
} from './computer-use-guidance'
import {
  COMPUTER_GUIDANCE_CLOSE_CHANNEL,
  COMPUTER_GUIDANCE_ENSURE_CHANNEL
} from '../shared/computer-use-contract'

const granted = { accessibility: true, screenRecording: true, eventPosting: true,
  permissionTarget: 'ActionDriver Computer Use' }

describe('Computer Use guidance window', () => {
  it('opens the renderer on the guidance surface without dropping existing query state', () => {
    expect(computerUseGuidanceUrl('actiondriver://renderer/index.html'))
      .toBe('actiondriver://renderer/index.html?surface=computer-use')
    expect(computerUseGuidanceUrl('http://localhost:5173/index.html?theme=dark'))
      .toBe('http://localhost:5173/index.html?theme=dark&surface=computer-use')
  })

  it('builds a fixed, non-closable window that keeps the main window usable', () => {
    const options = computerUseGuidanceWindowOptions('/preload/index.cjs', '/icon.png')
    expect(options).toMatchObject({
      width: 560,
      height: 640,
      resizable: false,
      closable: false,
      title: ''
    })
    expect(options.webPreferences).toMatchObject({ contextIsolation: true, sandbox: true })
  })

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

  it('opens the window at most once per ensure call and returns to the main window on close', async () => {
    const handlers = new Map<string, (_event: unknown, input: unknown) => Promise<unknown>>()
    const open = vi.fn()
    const close = vi.fn()
    const focusMain = vi.fn()
    registerComputerUseGuidanceIpc(
      { handle: (channel, handler) => { handlers.set(channel, handler) } },
      { open, close, focusMain, isPackaged: true,
        readPermissions: vi.fn(async () => ({ ...granted, accessibility: false })) }
    )

    await expect(handlers.get(COMPUTER_GUIDANCE_ENSURE_CHANNEL)!(null, {})).resolves.toBe(true)
    expect(open).toHaveBeenCalledOnce()

    await handlers.get(COMPUTER_GUIDANCE_CLOSE_CHANNEL)!(null, {})
    expect(close).toHaveBeenCalledOnce()
    expect(focusMain).toHaveBeenCalledOnce()
  })

  it('does not open the window when every permission is already granted in a packaged app', async () => {
    const handlers = new Map<string, (_event: unknown, input: unknown) => Promise<unknown>>()
    const open = vi.fn()
    registerComputerUseGuidanceIpc(
      { handle: (channel, handler) => { handlers.set(channel, handler) } },
      { open, close: vi.fn(), focusMain: vi.fn(), isPackaged: true,
        readPermissions: vi.fn(async () => granted) }
    )
    await expect(handlers.get(COMPUTER_GUIDANCE_ENSURE_CHANNEL)!(null, {})).resolves.toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})
