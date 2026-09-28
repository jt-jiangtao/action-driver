// @vitest-environment node
import { expect, test } from 'vitest'
import { originalDocumentation } from './original-service'
import { captureAuthPageBinding, revalidateAuthPageBinding } from '../src/service-auth-page-binding'

const initial = {
  id: 'frame-1', loaderId: 'loader-1', securityOrigin: 'https://login.example.com',
  url: 'https://login.example.com/signin', domainAndRegistry: 'example.com'
}
function context(frame: Record<string, unknown>) {
  return { cdp: { call: async (id: number, method: string) => {
    expect(id).toBe(7)
    expect(method).toBe('Page.getFrameTree')
    return { frameTree: { frame } }
  } } }
}
test('auth page binding rejects changed origin or incomplete document identity', async () => {
  const original = await originalDocumentation()
  for (const frame of [
    initial,
    { ...initial, securityOrigin: 'https://other.example.com' },
    { ...initial, url: 'https://other.example.com/signin' },
    { ...initial, loaderId: '' }
  ]) {
    expect(await captureAuthPageBinding('7', 'https://login.example.com', context(frame)))
      .toEqual(await original.baselineAuthPageBinding('7', 'https://login.example.com', context(frame)))
  }
})

test('auth page revalidation rejects frame, loader, URL and origin changes', async () => {
  const original = await originalDocumentation()
  const binding = await captureAuthPageBinding('7', 'https://login.example.com', context(initial))
  expect(typeof binding).toBe('object')
  for (const frame of [
    initial,
    { ...initial, id: 'frame-2' },
    { ...initial, loaderId: 'loader-2' },
    { ...initial, url: 'https://login.example.com/changed' },
    { ...initial, securityOrigin: 'https://other.example.com' }
  ])
    expect(await revalidateAuthPageBinding('7', 'https://login.example.com', binding as any, context(frame)))
      .toBe(await original.baselineAuthPageStatus('7', 'https://login.example.com', binding, context(frame)))
})
