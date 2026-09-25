import { describe, expect, it } from 'vitest'
import { computerHelperRequest, computerHelperResponse } from './computer-use-protocol'

describe('computer helper protocol', () => {
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
