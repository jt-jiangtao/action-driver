import { describe, expect, it } from 'vitest'
import { createCodexNativeClient } from './codex-native-client'

const context = { taskId: 'task', sessionId: 'session' }
const app = '/System/Applications/Notes.app'

describe('Codex native client adapter', () => {
  it('reports only acknowledged input text with its trusted execution context', async () => {
    const texts: Array<{ taskId: string; sessionId: string; text: string }> = []
    let result: unknown = { executed: true }
    const client = createCodexNativeClient({
      invoke: async () => result,
      writeScreenshot: async () => 'file:///unused.png',
      onExecutedText: (context, text) =>
        texts.push({ taskId: context.taskId, sessionId: context.sessionId, text })
    })
    await client.typeText({ app, text: 'typed 😀' }, context)
    await client.paste({ app, text: 'pasted', format: 'text' }, context)
    await client.setValue({ app, elementIndex: 42, value: 'value' }, context)
    await client.selectText({ app, elementIndex: 42, text: 'selected' }, context)
    result = { executed: false }
    await client.typeText({ app, text: 'not executed' }, context)
    expect(texts).toEqual(['typed 😀', 'pasted', 'value'].map((text) => ({ ...context, text })))
  })
  it('treats background input as delivered but unconfirmed and asks the model to verify it', async () => {
    const texts: string[] = []
    const notices: Array<{ taskId: string; text: string }> = []
    const client = createCodexNativeClient({
      invoke: async () => ({ executed: false, delivered: true }),
      writeScreenshot: async () => 'file:///unused.png',
      onExecutedText: (_, text) => texts.push(text),
      onNotice: (context, text) => notices.push({ taskId: context.taskId, text })
    })
    await client.typeText({ app, text: 'maybe typed' }, context)
    await client.pressKey({ app, key: 'Return' }, context)
    expect(texts).toEqual([])
    expect(notices).toHaveLength(2)
    expect(notices[0]).toMatchObject({ taskId: 'task' })
    expect(notices[0]!.text).toMatch(/getScreenshot|getAXState/)
  })
  it('does not record text when the native result is unknown or the request is cancelled', async () => {
    const texts: string[] = []
    const client = createCodexNativeClient({
      invoke: async () => {
        throw new Error('TIMED_OUT: may have executed')
      },
      writeScreenshot: async () => 'file:///unused.png',
      onExecutedText: (_, text) => texts.push(text)
    })
    await expect(client.typeText({ app, text: 'unknown' }, context)).rejects.toThrow('TIMED_OUT')
    const abort = new AbortController()
    abort.abort()
    await expect(
      client.typeText({ app, text: 'cancelled' }, { ...context, signal: abort.signal })
    ).rejects.toThrow('CANCELLED')
    expect(texts).toEqual([])
  })

  it('accepts the original short mouse and direction aliases', async () => {
    const actions: unknown[] = []
    const client = createCodexNativeClient({
      invoke: async (input) => {
        actions.push(input.action)
        return {}
      },
      writeScreenshot: async () => 'file:///unused.png'
    })
    await client.click({ app, elementIndex: 1, mouseButton: 'm' }, context)
    await client.scroll({ app, elementIndex: 2, direction: 'u' }, context)
    expect(actions).toEqual([
      { type: 'click-element', elementIndex: 1, mouseButton: 'middle' },
      { type: 'scroll', elementIndex: 2, deltaX: 0, deltaY: 600 }
    ])
  })
  it('passes helper-owned indexes and trusted session identity without observation or retry', async () => {
    const requests: Record<string, unknown>[] = []
    const client = createCodexNativeClient({
      invoke: async (input) => {
        requests.push(input)
        throw new Error('STALE_REFERENCE')
      },
      writeScreenshot: async () => 'file:///unused.png'
    })
    await expect(
      client.click({ app, elementIndex: 42, mouseButton: 'right', clickCount: 2 }, context)
    ).rejects.toThrow('STALE_REFERENCE')
    expect(requests).toEqual([
      {
        operation: 'act',
        app,
        sessionId: 'session',
        action: { type: 'click-element', elementIndex: 42, mouseButton: 'right', clickCount: 2 }
      }
    ])
  })

  it('translates state and PNG bytes to the original skyshot contract', async () => {
    const requests: Record<string, unknown>[] = []
    const images: Array<{ sessionId: string; bytes: number[]; mimeType: string }> = []
    const client = createCodexNativeClient({
      invoke: async (input) => {
        requests.push(input)
        return {
          app: 'com.apple.Notes',
          text: '[42] AXButton',
          appSpecificInstructions: 'guidance',
          screenshot: { base64: 'AQID', mimeType: 'image/png' }
        }
      },
      writeScreenshot: async (sessionId, bytes, mimeType) => {
        images.push({ sessionId, bytes: [...bytes], mimeType })
        return 'file:///session/screenshot.png'
      }
    })
    expect(await client.getAppState({ app, disableDiff: true }, context)).toEqual({
      app: { bundleIdentifier: 'com.apple.Notes' },
      appSpecificInstructions: 'guidance',
      skyshot: { text: '[42] AXButton', screenshot: { url: 'file:///session/screenshot.png' } }
    })
    expect(requests).toEqual([
      {
        operation: 'app-state',
        app,
        sessionId: 'session',
        maxElements: 300,
        maxDepth: 12,
        disableDiff: true,
        screenshot: true
      }
    ])
    expect(images).toEqual([{ sessionId: 'session', bytes: [1, 2, 3], mimeType: 'image/png' }])
  })

  it('preserves native action fields and forwards cancellation without dispatching an aborted call', async () => {
    const requests: Record<string, unknown>[] = []
    const signals: Array<AbortSignal | undefined> = []
    const client = createCodexNativeClient({
      invoke: async (input, signal) => {
        requests.push(input)
        signals.push(signal)
        return { executed: true }
      },
      writeScreenshot: async () => 'file:///unused.png'
    })
    const abort = new AbortController()
    const execution = { ...context, signal: abort.signal }
    await client.pressKey({ app, key: 'ctrl+shift+KP_Enter' }, execution)
    await client.selectText(
      { app, elementIndex: 43, text: '😀', selection: 'cursor_after' },
      execution
    )
    await client.scroll({ app, elementIndex: 44, direction: 'down', pages: 2 }, execution)
    await client.scroll({ app, x: 10, y: 20, direction: 'left', pages: 0.5 }, execution)
    await client.paste({ app, text: '', format: 'html' }, execution)
    expect(requests.map((r) => r.action)).toEqual([
      { type: 'key', key: 'ctrl+shift+KP_Enter', modifiers: [] },
      { type: 'select-text', elementIndex: 43, text: '😀', selectionType: 'cursor-after' },
      { type: 'scroll', elementIndex: 44, deltaX: 0, deltaY: -1200 },
      { type: 'scroll', x: 10, y: 20, deltaX: 300, deltaY: 0 },
      { type: 'paste', text: '', format: 'html' }
    ])
    expect(signals.every((signal) => signal === abort.signal)).toBe(true)
    abort.abort()
    await expect(client.typeText({ app, text: 'must not run' }, execution)).rejects.toThrow(
      'CANCELLED'
    )
    expect(requests).toHaveLength(5)
  })

  it('rejects malformed state and invalid mouse arguments before dispatch', async () => {
    const requests: Record<string, unknown>[] = []
    const client = createCodexNativeClient({
      invoke: async (input) => {
        requests.push(input)
        return {}
      },
      writeScreenshot: async () => 'file:///unused.png'
    })
    await expect(client.click({ app, elementIndex: 42, x: 1, y: 2 }, context)).rejects.toThrow(
      'INVALID_REQUEST'
    )
    await expect(client.click({ app, x: 1 }, context)).rejects.toThrow('INVALID_REQUEST')
    expect(requests).toHaveLength(0)
    await expect(client.getAppState({ app }, context)).rejects.toThrow('ENGINE_UNAVAILABLE')
  })
})
