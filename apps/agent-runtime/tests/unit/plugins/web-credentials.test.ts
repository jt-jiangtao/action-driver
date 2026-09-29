import { describe, expect, it } from 'vitest'
import { createWebCredentialPort } from '../../../src/plugins/web-credentials'
import type { InvocationContext, PluginOwner } from '@actiondriver/plugin-contracts'
const owner = { pluginId: 'web', version: '1.2.0', hostEpoch: 'test' }
const context = (tool: string): InvocationContext => ({
  callId: 'call',
  requestId: 'request',
  deadline: Date.now() + 1000,
  source: { kind: 'runtime' },
  chain: [tool],
  grants: [tool + '@1']
})
describe('web credentials', () => {
  it('provides only the credential matching the authoritative tool and grant', async () => {
    const port = createWebCredentialPort({ TAVILY_API_KEY: 'search', JINA_API_KEY: 'reader' })
    expect(port.configuration).toEqual({ searchConfigured: true, readerConfigured: true })
    expect(
      await port.credentials.request(
        owner,
        { id: 'tavily', purpose: 'search' },
        context('tools/local/web/search')
      )
    ).toBe('search')
    expect(
      await port.credentials.request(
        owner,
        { id: 'jina', purpose: 'read' },
        context('tools/local/web/open')
      )
    ).toBe('reader')
    expect(JSON.stringify(port.configuration)).not.toContain('reader"')
  })
  it('denies other plugins, mismatched calls, missing grants and arbitrary credential ids', async () => {
    const port = createWebCredentialPort({ TAVILY_API_KEY: 'search', JINA_API_KEY: 'reader' })
    const attempts: [PluginOwner, string, InvocationContext][] = [
      [{ ...owner, pluginId: 'other' }, 'tavily', context('tools/local/web/search')],
      [owner, 'jina', context('tools/local/web/search')],
      [owner, 'tavily', { ...context('tools/local/web/search'), grants: [] }],
      [owner, 'unknown', context('tools/local/web/search')]
    ]
    for (const [plugin, id, invocation] of attempts)
      await expect(
        port.credentials.request(plugin, { id, purpose: 'test' }, invocation)
      ).rejects.toThrow('AUTHORIZATION_DENIED')
  })
  it('keeps missing credentials independent and rejects request for an unavailable key', async () => {
    const port = createWebCredentialPort({ JINA_API_KEY: 'reader' })
    expect(port.configuration).toEqual({ searchConfigured: false, readerConfigured: true })
    await expect(
      port.credentials.request(
        owner,
        { id: 'tavily', purpose: 'search' },
        context('tools/local/web/search')
      )
    ).rejects.toThrow('UNAVAILABLE')
  })
})
