import { expect, test } from 'vitest'
import { axCommandHandlers } from '../src/service-ax-commands'
import { originalDocumentation } from './original-service'

async function handlers() {
  const baseline = await originalDocumentation()
  return [axCommandHandlers, { tab_ax_get_state: baseline.baselineAxGetState, tab_ax_action: baseline.baselineAxAction }]
}

test('observation authorizes and validates capture before returning state', async () => {
  for (const methods of await handlers()) {
    const calls: string[] = []
    const context = {
      getCurrentSessionId: () => 's1',
      ax: {
        capture: async () => { calls.push('capture'); return { state: 'Browser tab: 2' } },
        validateCapture: () => { calls.push('validate') }
      },
      security: { ensureCommandAllowed: async () => { calls.push('authorize') } }
    }
    const result = await methods.tab_ax_get_state({ tab_id: '2', content: 'axState', browser_id: 'b' }, context)
    expect(result).toEqual({ state: 'Browser tab: 2' })
    expect(calls).toEqual(['capture', 'authorize', 'validate'])
  }
})

test('screenshot unavailability rejects only after authorization and validation', async () => {
  for (const methods of await handlers()) {
    const calls: string[] = []
    const context = {
      getCurrentSessionId: () => 's1',
      ax: {
        capture: async () => ({ screenshot_unavailable: 'dialog open' }),
        validateCapture: () => { calls.push('validate') }
      },
      security: { ensureCommandAllowed: async () => { calls.push('authorize') } }
    }
    await expect(methods.tab_ax_get_state({ tab_id: 2, content: 'screenshot', browser_id: 'b' }, context)).rejects.toThrow('dialog open')
    expect(calls).toEqual(['authorize', 'validate'])
  }
})

test('successful action returns empty result after one dispatch', async () => {
  for (const methods of await handlers()) {
    const seen: any[] = []
    const context = { ax: { performAction: async (id: number, action: any) => { seen.push([id, action]) } } }
    const action = { kind: 'click', target: 4 }
    expect(await methods.tab_ax_action({ tab_id: '2', action }, context)).toEqual({})
    expect(seen).toEqual([[2, action]])
  }
})
