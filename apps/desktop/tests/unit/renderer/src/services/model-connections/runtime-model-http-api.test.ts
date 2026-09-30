import { describe, expect, it, vi } from 'vitest'
import { RuntimeModelHttpApi } from '../../../../../../src/renderer/src/services/model-connections/runtime-model-http-api'
import type { RuntimeHttpClient } from '../../../../../../src/renderer/src/services/transport/runtime-http-client'

describe('RuntimeModelHttpApi', () => {
  it('routes connection reads and writes directly to Runtime HTTP', async () => {
    const request = vi.fn(async () => [])
    const api = new RuntimeModelHttpApi({ request } as unknown as RuntimeHttpClient)
    await api.list()
    await api.refresh('connection-1')
    await api.setModelEnabled('connection-1', 'model-1', true)
    expect(request.mock.calls).toEqual([
      ['/model-connections'],
      ['/model-connections/connection-1/refresh', { method: 'POST' }],
      ['/model-connections/connection-1/models/model-1', {
        method: 'POST', body: { enabled: true }
      }]
    ])
  })
})
