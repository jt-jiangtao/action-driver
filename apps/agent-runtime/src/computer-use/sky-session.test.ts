import { describe, expect, it, vi } from 'vitest'
import { createSkySession } from './sky-session'

type Request = Record<string, unknown>

const state = (observationId: string) => ({
  observationId,
  app: 'TextEdit',
  tree: {
    ref: 'root', role: 'AXApplication', title: 'TextEdit',
    children: [
      { ref: 'field', role: 'AXTextArea', title: 'Draft', actions: ['press', 'setValue'],
        children: [{ ref: 'button', role: 'AXButton', title: 'Save' }] }
    ]
  },
  screenshot: { mimeType: 'image/jpeg', width: 800, height: 600,
    base64: Buffer.from('jpeg').toString('base64') }
})

function harness(handler?: (request: Request) => Promise<unknown> | unknown) {
  const calls: Request[] = []
  const invoke = vi.fn(async (request: Request) => {
    calls.push(request)
    if (handler) return await handler(request)
    if (request.operation === 'list-apps') return { apps: [{ id: 'com.apple.TextEdit' }] }
    if (request.operation === 'app-state') return state('obs-1')
    return { executed: true }
  })
  const writeScreenshot = vi.fn(async () => 'file:///tmp/computer-use-0.jpg')
  const session = createSkySession({ invoke, writeScreenshot })
  return { session, calls, invoke, writeScreenshot }
}

describe('sky session', () => {
  it('lists apps', async () => {
    const { session } = harness()
    expect(await session.invoke('list_apps', {})).toEqual([{ id: 'com.apple.TextEdit' }])
  })

  it('renders indexed accessibility text and a screenshot file url', async () => {
    const { session, writeScreenshot } = harness()
    const result = await session.invoke('get_app_state', { app: 'TextEdit' }) as {
      app: string; text: string; screenshot: { url: string }
    }
    expect(result.app).toBe('TextEdit')
    expect(result.text).toBe([
      '[0] AXApplication "TextEdit"',
      '  [1] AXTextArea "Draft" actions=[press,setValue]',
      '    [2] AXButton "Save"'
    ].join('\n'))
    expect(writeScreenshot).toHaveBeenCalledWith(Buffer.from('jpeg'), 'image/jpeg')
    expect(result.screenshot).toEqual({ url: 'file:///tmp/computer-use-0.jpg' })
  })

  it('resolves an element index against the latest state', async () => {
    const { session, calls } = harness()
    await session.invoke('get_app_state', { app: 'TextEdit' })
    await session.invoke('click', { app: 'TextEdit', element_index: 2 }, undefined, { allowActions: true })
    const acts = calls.filter((call) => call.operation === 'act')
    expect(acts).toHaveLength(1)
    expect(acts[0]!.action).toEqual({ type: 'click-element', elementRef: 'button' })
    expect(calls.filter((call) => call.operation === 'app-state')).toHaveLength(1)
  })

  it('reads the interface first when the app has no state yet', async () => {
    const { session, calls } = harness()
    await session.invoke('set_value', { app: 'TextEdit', element_index: 1, value: 'hello' },
      undefined, { allowActions: true })
    expect(calls.map((call) => call.operation)).toEqual(['app-state', 'act'])
    expect(calls[1]!.action).toEqual({ type: 'set-value', elementRef: 'field', value: 'hello' })
  })

  it('re-reads and retries once when the interface moved', async () => {
    const { session, calls } = harness(async (request) => {
      if (request.operation === 'list-apps') return { apps: [] }
      if (request.operation === 'app-state') return state(`obs-${calls.length}`)
      if (request.operation === 'act' && request.observationId === 'obs-1') {
        throw new Error('STALE_REFERENCE: Observe the current interface again')
      }
      return { executed: true }
    })
    await session.invoke('get_app_state', { app: 'TextEdit' })
    await session.invoke('click', { app: 'TextEdit', element_index: 0 }, undefined, { allowActions: true })
    const acts = calls.filter((call) => call.operation === 'act')
    expect(acts).toHaveLength(2)
    expect(acts[1]!.observationId).not.toBe('obs-1')
  })

  it('rejects an element index outside the latest state', async () => {
    const { session, calls } = harness()
    await session.invoke('get_app_state', { app: 'TextEdit' })
    await expect(session.invoke('click', { app: 'TextEdit', element_index: 99 }, undefined,
      { allowActions: true }))
      .rejects.toThrow('element_index 99 is outside the latest state')
    expect(calls.filter((call) => call.operation === 'act')).toHaveLength(0)
  })

  it('translates keyboard syntax the helper understands', async () => {
    const { session, calls } = harness()
    await session.invoke('press_key', { app: 'TextEdit', key: 'super+c' }, undefined, { allowActions: true })
    expect(calls.at(-1)!.action).toEqual({ type: 'key', key: 'c', modifiers: ['command'] })
    await expect(session.invoke('press_key', { app: 'TextEdit', key: 'F13' }, undefined,
      { allowActions: true }))
      .rejects.toThrow('is not supported by the native helper')
  })

  it('maps scroll pages onto wheel deltas', async () => {
    const { session, calls } = harness()
    await session.invoke('scroll', { app: 'TextEdit', direction: 'down', pages: 2 })
    expect(calls.at(-1)!.action).toEqual({ type: 'scroll', deltaX: 0, deltaY: -1200 })
  })

  it('refuses methods outside the documented surface', async () => {
    const { session } = harness()
    await expect(session.invoke('launch_missiles', {})).rejects.toThrow('does not exist')
  })

  it('retries a localized display name with the bundle id from list_apps', async () => {
    const { session, calls } = harness(async (request) => {
      if (request.operation === 'list-apps') {
        return { apps: [{ id: 'com.apple.TextEdit', displayName: '文本编辑', isRunning: true }] }
      }
      if (request.operation === 'app-state' && request.app === 'com.apple.TextEdit') {
        return { ...state('obs-1'), app: 'com.apple.TextEdit' }
      }
      if (request.operation === 'app-state') {
        // The helper only understands bundle ids, paths and English `.app` names.
        throw new Error(`ACTION_FAILED: Unknown application: ${String(request.app)}`)
      }
      return { executed: true }
    })
    const result = await session.invoke('get_app_state', { app: '文本编辑' }) as { app: string }
    expect(result.app).toBe('com.apple.TextEdit')
    expect(calls.map((call) => call.operation)).toEqual(['app-state', 'list-apps', 'app-state'])
    // The learned spelling is reused, so the next call goes straight to the bundle id.
    await session.invoke('click', { app: '文本编辑', element_index: 0 }, undefined, { allowActions: true })
    expect(calls.filter((call) => call.operation === 'app-state')).toHaveLength(2)
  })

  it('refuses a desktop action in a cell that was not confirmed', async () => {
    const { session, calls } = harness()
    await expect(session.invoke('click', { app: 'TextEdit', element_index: 0 }))
      .rejects.toThrow('APPROVAL_REQUIRED')
    await expect(session.invoke('type_text', { app: 'TextEdit', text: 'hi' }))
      .rejects.toThrow('APPROVAL_REQUIRED')
    // Reads and scrolling stay available without confirmation, exactly like `computer_act`.
    await expect(session.invoke('list_apps', {})).resolves.toBeTruthy()
    await session.invoke('scroll', { app: 'TextEdit', direction: 'down' })
    expect(calls.some((call) => call.operation === 'act')).toBe(true)
  })

  it('performs the action once the cell is confirmed', async () => {
    const { session, calls } = harness()
    await session.invoke('get_app_state', { app: 'TextEdit' }, undefined, { allowActions: true })
    await session.invoke('type_text', { app: 'TextEdit', text: 'hello' }, undefined,
      { allowActions: true })
    expect(calls.filter((call) => call.operation === 'act'))
      .toEqual([{ operation: 'act', observationId: 'obs-1', action: { type: 'type', text: 'hello' } }])
  })
})
