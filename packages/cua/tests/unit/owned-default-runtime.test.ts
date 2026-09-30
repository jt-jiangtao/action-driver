// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { createTinyskyAlt } from '../../src/default-runtime'

test('default runtime refuses private global service when no owned host is supplied', async () => {
  const rpc = vi.fn()
  vi.stubGlobal('nodeRepl', { rpc, env: {} })
  try {
    expect(() => createTinyskyAlt({ browser: true, computer: false })).toThrow('BROWSER_HOST_UNAVAILABLE')
    expect(() => createTinyskyAlt({ browser: false, computer: true })).toThrow('SKY_HOST_UNAVAILABLE')
    expect(rpc).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals() }
})

test('computer-only default uses Action-Driver helper without a private RPC', async () => {
  const requests: string[] = []
  const computerHost = { request: vi.fn(async (input: any) => {
    requests.push(input.operation)
    if (input.operation === 'list-apps') return { apps: [{ id: 'TextEdit', displayName: 'TextEdit' }] }
    return { accepted: true }
  }) }
  const runtime = await createTinyskyAlt({ browser: false, computerHost, sessionId: 's' })
  expect(await runtime.getState({ emit: false })).toEqual({ apps: [{ id: 'TextEdit', displayName: 'TextEdit' }], browsers: [] })
  expect(requests).toEqual(['list-apps'])
})
