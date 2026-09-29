// @vitest-environment node
import { expect, test } from 'vitest'
import { requestManualAuthHandoff } from '../../src/service-auth-handoff'

test('manual handoff marks an existing controlled CDP tab', async () => {
  const marks: Array<[number, string]> = []
  const result = await requestManualAuthHandoff({ tab_id: '7' }, {
    clientInfo: { name: 'test', type: 'cdp', capabilities: { tab: [{ id: 'browserAuth' }] } },
    runtime: { env: {} },
    tabs: {
      get: async (id) => {
        if (id !== 7) throw Error('wrong tab')
      },
      mark: async (id, status) => { marks.push([id, status]) }
    }
  })
  expect(result).toEqual({})
  expect(marks).toEqual([[7, 'handoff']])
})

test('manual handoff fails closed for unsupported clients and missing tabs', async () => {
  const marks: Array<[number, string]> = []
  const context = {
    clientInfo: { name: 'test', type: 'cdp', capabilities: { tab: [] as Array<{ id: string }> } },
    runtime: { env: {} },
    tabs: { get: async () => { throw Error('missing tab') }, mark: async (id: number, status: string) => { marks.push([id, status]) } }
  }
  await expect(requestManualAuthHandoff({ tab_id: '7' }, context)).rejects.toThrow()
  context.clientInfo.capabilities.tab.push({ id: 'browserAuth' })
  await expect(requestManualAuthHandoff({ tab_id: '7' }, context)).rejects.toThrow('missing tab')
  expect(marks).toEqual([])
})

test('client unsupported flag blocks takeover before tab lookup', async () => {
  let lookedUp = false
  await expect(requestManualAuthHandoff({ tab_id: '7' }, {
    clientInfo: { name: 'test', type: 'cdp', capabilities: { tab: [{ id: 'browserAuth' }] } },
    runtime: { env: {}, requestMeta: { 'x-codex-turn-metadata': { browser_auth_client_unsupported: 'true' } } },
    tabs: { get: async () => { lookedUp = true }, mark: async () => {} }
  })).rejects.toThrow('does not support cloud browser takeover')
  expect(lookedUp).toBe(false)
})
