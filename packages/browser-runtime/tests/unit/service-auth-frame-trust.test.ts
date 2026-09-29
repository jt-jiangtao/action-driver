// @vitest-environment node
import { expect, test } from 'vitest'
import { originalDocumentation } from '../original-service'
import { sameAuthRegistration, trustAuthFormOrigin, trustAuthFrameChain } from '../../src/service-auth-frame-trust'

const top = { domainAndRegistry: 'example.com', frameId: 'top', loaderId: 'l1',
  origin: 'https://shop.example.com', targetKey: '7::', url: 'https://shop.example.com/login' }
const form = { ...top, domainAndRegistry: 'other.com', frameId: 'form',
  origin: 'https://login.other.com', url: 'https://login.other.com/' }

test('registration-domain fallback and cross-site requirement match original', async () => {
  const original = await originalDocumentation()
  for (const [left, right] of [
    [top, { ...form, domainAndRegistry: 'example.com' }],
    [top, form],
    [{ ...top, domainAndRegistry: '' }, { ...form, domainAndRegistry: '' }],
    [{ ...top, domainAndRegistry: '' }, { ...form, domainAndRegistry: '' , url: top.url }]
  ] as const)
    expect(sameAuthRegistration(left, right)).toBe(original.baselineAuthDomainTrust(left, right))
})

test('nested iframe intermediate origins match original top-or-form chain rule', async () => {
  const original = await originalDocumentation()
  const selector = '#outer >> internal:control=enter-frame >> #inner >> internal:control=enter-frame >> #password'
  const params = { tab_id: '7', timeout_ms: 900,
    fields: [{ selector }], submit: { selector: '#submit' } }
  async function exercise(run: Function, domainAndRegistry: string) {
    const calls: string[] = []
    const ctx = { playwright: { evaluateOnPlaywrightSelectorWithTarget: async (_tab: string, prefix: string) => {
      calls.push(prefix)
      return { frameIdentity: { frameId: 'middle', loaderId: 'l2',
        domainAndRegistry, url: 'https://middle.example.net/frame' },
      result: 'https://middle.example.net/frame', target: { tabId: 7 } }
    } } }
    return { trusted: await run(top, form, params, ctx), calls }
  }
  for (const domain of ['example.com', 'other.com', 'example.net'])
    expect(await exercise(trustAuthFrameChain, domain)).toEqual(
      await exercise(original.baselineAuthFrameTrust, domain))
})

test('cross-site form rejects missing registrable domains and unrelated intermediate frame', async () => {
  const selector = '#outer >> internal:control=enter-frame >> #inner >> internal:control=enter-frame >> #password'
  const params = { tab_id: '7', fields: [{ selector }] }
  const context = { playwright: { evaluateOnPlaywrightSelectorWithTarget: async () => ({
    frameIdentity: { frameId: 'middle', loaderId: 'l2',
      domainAndRegistry: 'attacker.net', url: 'https://attacker.net/frame' },
    result: 'https://attacker.net/frame', target: { tabId: 7 }
  }) } }
  expect(await trustAuthFormOrigin({ ...top, domainAndRegistry: '' }, form, params, context)).toBe(false)
  expect(await trustAuthFormOrigin(top, form, params, context)).toBe(false)
})
