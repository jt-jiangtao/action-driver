// @vitest-environment node
import { expect, test } from 'vitest'
import { originalDocumentation } from '../original-service'
import {
  captureAuthFormBinding,
  captureAuthOptionBindings,
  revalidateAuthFormBinding
} from '../../src/service-auth-form-binding'

const request = {
  tab_id: '7', timeout_ms: 900,
  fields: [{ selector: '#username' }, { selector: '#password' }],
  submit: { selector: '#submit' },
  options: [{ id: 'first', selector: '#first' }, { id: 'second', selector: '#second' }]
}
function context(overrides: Record<string, any> = {}) {
  const calls: string[] = []
  return {
    calls,
    playwright: {
      evaluateOnPlaywrightSelectorWithTarget: async (_tab: string, selector: string) => {
        calls.push(selector)
        const change = overrides[selector] ?? {}
        if (change instanceof Error) throw change
        return {
          frameIdentity: {
            frameId: 'frame-1', loaderId: 'loader-1',
            url: 'https://example.com/login', domainAndRegistry: 'example.com',
            ...change.frameIdentity
          },
          result: 'https://example.com/login',
          target: { tabId: 7, sessionId: 'session-1', targetId: 'target-1', ...change.target },
          ...change
        }
      }
    }
  }
}

test('form binding requires all field and submit selectors in one document and target', async () => {
  const original = await originalDocumentation()
  for (const changes of [
    {},
    { '#password': { target: { targetId: 'target-2' } } },
    { '#submit': { frameIdentity: { url: 'https://other.example.com/login' } } },
    { '#username': Error('missing') }
  ]) {
    const ours = context(changes)
    const baseline = context(changes)
    expect(await captureAuthFormBinding(request, ours)).toEqual(
      await original.baselineAuthFormBinding(request, baseline)
    )
    expect(ours.calls).toEqual(baseline.calls)
  }
})

test('option binding maps independently and fails closed if a selector fails', async () => {
  const original = await originalDocumentation()
  for (const changes of [{}, { '#second': Error('missing') }]) {
    const ours = context(changes)
    const baseline = context(changes)
    expect(await captureAuthOptionBindings(request, ours)).toEqual(
      await original.baselineAuthOptionBindings(request, baseline)
    )
  }
})

test('form revalidation classifies target, origin and document changes', async () => {
  const original = await originalDocumentation()
  const binding = await captureAuthFormBinding(request, context())
  expect(binding).not.toBeNull()
  for (const changes of [
    {},
    { '#username': { target: { targetId: 'target-2' } } },
    { '#username': { frameIdentity: { url: 'https://other.example.com/login' }, result: 'https://other.example.com/login' } },
    { '#username': { frameIdentity: { loaderId: 'loader-2' } } }
  ]) {
    expect(await revalidateAuthFormBinding(request, binding!, context(changes))).toBe(
      await original.baselineAuthFormStatus(request, binding, context(changes))
    )
  }
})
