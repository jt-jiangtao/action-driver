import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from '../../../src/preload/desktop-api'
import { RUNTIME_CONNECTION_IPC_CHANNEL } from '../../../src/shared/runtime-connection-contract'
import { EXTERNAL_LINK_OPEN_CHANNEL } from '../../../src/shared/external-link-contract'
import {
  BROWSER_SESSION_COMMAND_CHANNEL,
  BROWSER_SESSION_EVENT_CHANNEL,
  BROWSER_SESSION_VIEWPORT_CHANNEL
} from '../../../src/shared/browser-session-contract'
import {
  COMPUTER_GUIDANCE_ENSURE_CHANNEL,
  COMPUTER_PERMISSIONS_CHECK_CHANNEL
} from '../../../src/shared/computer-use-contract'

describe('preload Runtime bootstrap', () => {
  it('exposes only environment and the authenticated Runtime connection', async () => {
    const connection = {
      wsUrl: 'ws://127.0.0.1:4321/stream',
      protocol: 'action-driver.stream.v2',
      accessToken: 'launch-token'
    }
    const invoke = vi.fn(async () => connection)
    const api = createDesktopApi('darwin', '0.1.0', { invoke })
    expect(Object.keys(api).sort()).toEqual([
      'browserSession',
      'computerUse',
      'externalLinks',
      'getEnvironment',
      'pluginContributions',
      'runtimeConnection',
      'skillFolders',
      'taskOutput'
    ])
    expect(api.getEnvironment()).toEqual({ platform: 'darwin', version: '0.1.0' })
    await expect(api.runtimeConnection.get()).resolves.toEqual(connection)
    expect(invoke).toHaveBeenCalledWith(RUNTIME_CONNECTION_IPC_CHANNEL, {})
    await api.externalLinks.open('https://example.com/story')
    expect(invoke).toHaveBeenCalledWith(EXTERNAL_LINK_OPEN_CHANNEL, 'https://example.com/story')
  })

  it('asks the helper to prompt the system only for an explicit authorization request', async () => {
    const status = { accessibility: false, screenRecording: false, eventPosting: false,
      permissionTarget: 'Action-Driver Computer Use' }
    const invoke = vi.fn(async () => status)
    const api = createDesktopApi('darwin', '0.1.0', { invoke })

    await expect(api.computerUse.permissions()).resolves.toEqual(status)
    expect(invoke).toHaveBeenLastCalledWith(COMPUTER_PERMISSIONS_CHECK_CHANNEL, {})

    await expect(api.computerUse.requestPermissions('accessibility')).resolves.toEqual(status)
    expect(invoke).toHaveBeenLastCalledWith(COMPUTER_PERMISSIONS_CHECK_CHANNEL,
      { prompt: true, target: 'accessibility' })
  })

  it('asks Main to present the native guidance window', async () => {
    const invoke = vi.fn(async () => true)
    const api = createDesktopApi('darwin', '0.1.0', { invoke })

    await api.computerUse.ensureGuidance()
    expect(invoke).toHaveBeenLastCalledWith(COMPUTER_GUIDANCE_ENSURE_CHANNEL, {})
  })

  it('exposes only the named browser command and event channels', async () => {
    let onEvent: ((value: unknown) => void) | undefined
    const invoke = vi.fn(async () => ({ sessionId: 's-1', surface: 'embedded', status: 'running',
      activeTabId: null, tabs: [], error: null }))
    const api = createDesktopApi('darwin', '0.1.0', {
      invoke,
      on(channel, listener) {
        expect(channel).toBe(BROWSER_SESSION_EVENT_CHANNEL)
        onEvent = listener
        return () => { onEvent = undefined }
      }
    })
    const request = { action: 'open' as const, taskId: 'task-1', surface: 'embedded' as const }
    await expect(api.browserSession.command(request)).resolves.toMatchObject({ sessionId: 's-1' })
    expect(invoke).toHaveBeenCalledWith(BROWSER_SESSION_COMMAND_CHANNEL, request)
    await api.browserSession.setViewport({ taskId: 'task-1', sessionId: 's-1',
      bounds: { x: 12, y: 40, width: 420, height: 320 }, visible: true })
    expect(invoke).toHaveBeenCalledWith(BROWSER_SESSION_VIEWPORT_CHANNEL, {
      taskId: 'task-1', sessionId: 's-1',
      bounds: { x: 12, y: 40, width: 420, height: 320 }, visible: true
    })

    const listener = vi.fn()
    const unsubscribe = api.browserSession.subscribe(listener)
    onEvent?.({ taskId: 'task-1', snapshot: { sessionId: 's-1' } })
    expect(listener).toHaveBeenCalledWith({ taskId: 'task-1', snapshot: { sessionId: 's-1' } })
    unsubscribe()
    expect(onEvent).toBeUndefined()
  })
})
