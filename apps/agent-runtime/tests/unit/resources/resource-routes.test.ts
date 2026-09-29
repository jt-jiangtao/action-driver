// @vitest-environment node
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { ResourceError } from '@actiondriver/runtime-contracts'
import { RESOURCE_INLINE_MAX_BYTES, registerResourceRoutes } from '../../../src/service/http/http-routes-resources'
import { mapErrorToResponse } from '../../../src/service/http/http-errors'
import { failure } from '../../../src/service/http/http-contract'

function app(port: Parameters<typeof registerResourceRoutes>[1]) {
  const instance = new Hono()
  registerResourceRoutes(instance, port)
  instance.onError((error, context) => {
    const mapped = mapErrorToResponse(error as Error)
    return context.json(failure(mapped.code, mapped.message), mapped.status)
  })
  return instance
}

const chunks = async function * (...values: string[]) { for (const value of values) yield new TextEncoder().encode(value) }

describe('resource routes', () => {
  it('reads a resource with the caller scope and returns a bounded inline body', async () => {
    const read = vi.fn(async () => ({ uri: 'adr://v1/workspace/a.txt', version: '2', contentType: 'text/plain', stream: chunks('ab', 'cd') }))
    const response = await app({ read, list: async () => [] }).request('/resources/read', { method: 'POST', body: JSON.stringify({ uri: 'adr://v1/workspace/a.txt', taskId: 'task-1', sessionId: 'session-1' }) })
    expect(read).toHaveBeenCalledWith('adr://v1/workspace/a.txt', { sessionId: 'session-1', taskId: 'task-1' })
    expect(await response.json()).toEqual({ ok: true, value: { uri: 'adr://v1/workspace/a.txt', version: '2', contentType: 'text/plain', byteLength: 4, base64: Buffer.from('abcd').toString('base64') } })
  })

  it('refuses to inline a resource larger than the bounded limit', async () => {
    const oversized = async function * () { yield new Uint8Array(RESOURCE_INLINE_MAX_BYTES + 1) }
    const response = await app({ read: async () => ({ uri: 'adr://v1/workspace/big.bin', version: '1', stream: oversized() }), list: async () => [] })
      .request('/resources/read', { method: 'POST', body: JSON.stringify({ uri: 'adr://v1/workspace/big.bin', sessionId: 'session-1' }) })
    const body = await response.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('RESOURCE_UNSUPPORTED')
  })

  it('requires a session scope and re-uses registry refusals as structured errors', async () => {
    const invalid = await app({ read: async () => { throw new Error('unused') }, list: async () => [] })
      .request('/resources/read', { method: 'POST', body: JSON.stringify({ uri: 'adr://v1/workspace/a.txt' }) })
    expect(invalid.status).toBeGreaterThanOrEqual(400)
    const denied = await app({ read: async () => { throw new ResourceError('RESOURCE_UNAUTHORIZED', 'cross-session') }, list: async () => [] })
      .request('/resources/read', { method: 'POST', body: JSON.stringify({ uri: 'adr://v1/workspace/a.txt', sessionId: 'session-9' }) })
    const body = await denied.json() as { error: { code: string } }
    expect(body.error.code).toBe('RESOURCE_UNAUTHORIZED')
  })
})
