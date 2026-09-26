import { describe, expect, it } from 'vitest'
import { computerHelperRequest, computerHelperResponse } from './computer-use-protocol'

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

  it('accepts a bounded cross-app observation request and rejects unexpected fields', () => {
    const request = {
      version: 1,
      requestId: 'observe-1',
      deadlineUnixMs: Date.now() + 1000,
      operation: 'observe',
      maxElements: 200,
      maxDepth: 8
    }
    expect(computerHelperRequest.parse(request)).toEqual(request)
    expect(computerHelperRequest.safeParse({ ...request, script: 'rm -rf /' }).success).toBe(false)
  })

  it('rejects actions without a recent observation reference', () => {
    const base = {
      version: 1,
      requestId: 'click-1',
      deadlineUnixMs: Date.now() + 1000,
      operation: 'act',
      action: { type: 'click', x: 100, y: 200 }
    }
    expect(computerHelperRequest.safeParse(base).success).toBe(false)
    expect(computerHelperRequest.safeParse({
      ...base,
      observationId: 'observation-1'
    }).success).toBe(true)
  })

  it('accepts the Codex-parity action set and rejects malformed variants', () => {
    const base = {
      version: 1, requestId: 'act-1', deadlineUnixMs: Date.now() + 1000,
      operation: 'act', observationId: 'observation-1'
    }
    const actions = [
      { type: 'set-value', elementRef: 'ref-1', value: 'hello' },
      { type: 'paste', text: 'hello', format: 'md' },
      { type: 'select-text', elementRef: 'ref-1', text: 'hello', selectionType: 'cursor-after' },
      { type: 'drag', fromX: 1, fromY: 2, toX: 30, toY: 40 },
      { type: 'secondary-action', elementRef: 'ref-1', action: 'Show Menu' }
    ]
    for (const action of actions) {
      expect(computerHelperRequest.safeParse({ ...base, action }).success).toBe(true)
    }
    expect(computerHelperRequest.safeParse({ ...base,
      action: { type: 'paste', text: 'x', format: 'pdf' } }).success).toBe(false)
    expect(computerHelperRequest.safeParse({ ...base,
      action: { type: 'set-value', elementRef: 'ref-1' } }).success).toBe(false)
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
})
