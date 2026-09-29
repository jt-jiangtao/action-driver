import { describe, expect, it } from 'vitest'
import { computerHelperRequest, computerHelperResponse } from '../../src/computer-use-protocol'

describe('computer helper protocol', () => {
  it('accepts a permission probe with and without the authorization prompt flag', () => {
    const base = {
      version: 1,
      requestId: 'permissions-1',
      deadlineUnixMs: Date.now() + 1000,
      operation: 'permissions'
    }
    expect(computerHelperRequest.parse(base)).toEqual(base)
    expect(computerHelperRequest.parse({ ...base, prompt: true })).toEqual({ ...base, prompt: true })
    expect(computerHelperRequest.parse({ ...base, prompt: true, target: 'screenRecording' }))
      .toEqual({ ...base, prompt: true, target: 'screenRecording' })
    expect(computerHelperRequest.safeParse({ ...base, prompt: 'yes' }).success).toBe(false)
    expect(computerHelperRequest.safeParse({ ...base, prompt: true, target: 'microphone' }).success)
      .toBe(false)
  })

  it('accepts the native guidance window request', () => {
    const request = {
      version: 1,
      requestId: 'guidance-1',
      deadlineUnixMs: Date.now() + 1000,
      operation: 'guidance'
    }
    expect(computerHelperRequest.parse(request)).toEqual(request)
    expect(computerHelperRequest.safeParse({ ...request, visible: true }).success).toBe(false)
  })

  // 4.1: the observation-based observe / capture / act operations are removed entirely.
  it('rejects the removed observation-based requests', () => {
    const base = {
      version: 1,
      requestId: 'legacy-1',
      deadlineUnixMs: Date.now() + 1000
    }
    for (const request of [
      { ...base, operation: 'observe', maxElements: 200, maxDepth: 8 },
      { ...base, operation: 'capture', maxWidth: 100, maxHeight: 100 },
      { ...base, operation: 'act', observationId: 'old', action: { type: 'click', x: 1, y: 2 } }
    ]) {
      expect(computerHelperRequest.safeParse(request).success).toBe(false)
    }
  })

  it('keeps helper errors structured and rejects unknown response fields', () => {
    const error = {
      version: 1,
      requestId: 'observe-1',
      ok: false,
      error: { code: 'ACCESSIBILITY_DENIED', message: 'Enable Accessibility' }
    }
    expect(computerHelperResponse.parse(error)).toEqual(error)
    expect(computerHelperResponse.safeParse({ ...error, screenshot: 'secret' }).success).toBe(false)
  })
  it('accepts app policy probes without an observation or desktop action', () => {
    const request = { version: 1, requestId: 'policy-1', deadlineUnixMs: 9999999999999,
      operation: 'app-policy', app: 'com.apple.Notes' }
    expect(computerHelperRequest.parse(request)).toEqual(request)
    expect(computerHelperRequest.safeParse({ ...request, action: { type: 'type', text: 'x' } }).success)
      .toBe(false)
  })

  it('accepts session-scoped indexed actions and rejects mixed or missing targets', () => {
    const request = { version: 1, requestId: 'app-act-1', deadlineUnixMs: 9999999999999,
      operation: 'act', sessionId: 'session-1', app: 'com.apple.Notes',
      action: { type: 'click-element', elementIndex: 3 } }
    expect(computerHelperRequest.parse(request)).toEqual(request)
    expect(computerHelperRequest.safeParse({ ...request, observationId: 'old' }).success).toBe(false)
    expect(computerHelperRequest.safeParse({ ...request, sessionId: undefined }).success).toBe(false)
    expect(computerHelperRequest.safeParse({ ...request, app: undefined }).success).toBe(false)
    expect(computerHelperRequest.safeParse({ ...request,
      action: { type: 'click-element', elementIndex: -1 } }).success).toBe(false)
    expect(computerHelperRequest.safeParse({ ...request,
      action: { type: 'click-element', elementIndex: 1.5 } }).success).toBe(false)
    expect(computerHelperRequest.safeParse({ ...request,
      action: { type: 'click-element', elementRef: 'old' } }).success).toBe(false)
  })

  it('accepts session supervision and rejects sessions on unrelated operations', () => {
    const start = { version: 1, requestId: 'session-1', deadlineUnixMs: 9999999999999,
      operation: 'session-start', sessionId: 'session-1' }
    const end = { ...start, requestId: 'session-2', operation: 'session-end' }
    expect(computerHelperRequest.parse(start)).toEqual(start)
    expect(computerHelperRequest.parse(end)).toEqual(end)
    expect(computerHelperRequest.safeParse({ ...start, sessionId: '' }).success).toBe(false)
    expect(computerHelperRequest.safeParse({ ...start, app: 'com.apple.Notes' }).success).toBe(false)
    expect(computerHelperRequest.safeParse({ version: 1, requestId: 'x',
      deadlineUnixMs: 9999999999999, operation: 'list-apps', sessionId: 'session-1' }).success)
      .toBe(false)
  })

  it('accepts application observations with session isolation and optional window screenshots', () => {
    const request = { version: 1, requestId: 'app-state-1', deadlineUnixMs: 9999999999999,
      operation: 'app-state', sessionId: 'session-1', app: 'com.apple.Notes',
      maxElements: 200, maxDepth: 8, disableDiff: true, screenshot: true }
    expect(computerHelperRequest.parse(request)).toEqual(request)
    expect(computerHelperRequest.safeParse({ ...request, sessionId: '' }).success).toBe(false)
    expect(computerHelperRequest.safeParse({ ...request, screenshot: 'yes' }).success).toBe(false)
  })

  it.each(['APP_FORBIDDEN', 'APP_DENIED', 'AMBIGUOUS_APP', 'APP_BUSY',
    'USER_STOPPED_SESSION', 'USER_INTERVENED', 'BACKGROUND_INPUT_UNSUPPORTED'])(
    'preserves the application error code %s for the runtime', (code) => {
      const response = { version: 1, requestId: 'app-act-1', ok: false,
        error: { code, message: 'Application operation refused' } }
      expect(computerHelperResponse.parse(response)).toEqual(response)
    })

})
