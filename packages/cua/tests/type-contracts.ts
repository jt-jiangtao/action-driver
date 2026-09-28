import type { AnyArray, ArrayItem, AnyFunction, Merge, Pretty, Param } from '../src/types/index.js'
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
export type Checks = [
  Assert<Equal<ArrayItem<[string, number]>, string | number>>,
  Assert<Equal<Merge<{ a: string; b: number }, { b: boolean }>, { a: string; b: boolean }>>,
  Assert<Equal<Pretty<{ a: 1 } & { b: 2 }>, { a: 1; b: 2 }>>,
  Assert<Equal<Param.All<(a: string, b: number) => void>, [a: string, b: number]>>,
  Assert<Equal<Param.First<(a: string, b: number) => void>, string>>,
  Assert<Equal<Param.Second<(a: string, b: number) => void>, number>>,
  Assert<Equal<Param.Third<(a: string, b: number, c: boolean) => void>, boolean>>,
  Assert<Equal<Param.At<1, (a: string, b: number) => void>, number>>,
  Assert<Equal<[1, 2] extends AnyArray ? true : false, true>>,
  Assert<Equal<(() => void) extends AnyFunction ? true : false, true>>
]

import { createBrowserSession } from '../src/browser-session'
import type { SessionBrowser, SessionTab, SessionBrowsers } from '../src/browser-session'
import { registerCUAGlobal } from '../src/global-registration'
declare const injectedBrowsers: SessionBrowsers
const browserSession = createBrowserSession({ agent: { browsers: injectedBrowsers } })
async function browserSessionContracts() {
  const session = await browserSession
  const selected: SessionBrowser = await session.getBrowser({ id: 'b' })
  const created: SessionTab = await session.createBrowserTab('b', 'example.test', { visible: true })
  const referenced: SessionTab = await session.getTab(
    { url: 'https://example.test/' },
    { browser: 'b' }
  )
  const rewritten: void = await session.rewriteDocumentation()
  const listed: Array<{ browserId: string; id: string }> = await session.listTabs()
  return [selected, created, referenced, rewritten, listed]
}
const registered: Promise<void> = registerCUAGlobal(async ({ browser, computer }) => ({
  getState: async () => ({ browser, computer })
}))
void [browserSessionContracts, registered]

import { createCUASession } from '../src/session'
import { createConfiguredCUASession } from '../src/runtime-factory'
import type { MacComputer } from '../src/computer-session'
declare const injectedComputer: MacComputer
async function combinedSessionContracts() {
  const both = await createCUASession({
    agent: { browsers: injectedBrowsers },
    computer: injectedComputer
  })
  const browser: SessionBrowser = await both.getBrowser({ id: 'b' })
  const tab: SessionTab = await both.createBrowserTab('b')
  const app = await both.getApp('app')
  const desktop: MacComputer = both.computer
  const apps: Array<{ id: string }> = await both.listApps()
  const browserOnly = await createCUASession({ agent: { browsers: injectedBrowsers } })
  const selected: SessionBrowser = await browserOnly.getBrowser()
  const computerOnly = await createCUASession({ computer: injectedComputer })
  const selectedComputer: MacComputer = computerOnly.computer
  const configured = await createConfiguredCUASession(
    {},
    {
      platform: 'darwin',
      loadBrowserSetup: async () => async () => ({ browsers: injectedBrowsers }),
      loadComputer: async () => injectedComputer
    }
  )
  const rewrite: void = await configured.rewriteDocumentation()
  return [browser, tab, app, desktop, apps, selected, selectedComputer, rewrite]
}
void combinedSessionContracts
import { createLegacyCUAFacade } from '../src/legacy-facade'
import type { ComputerDiscovery, BrowserProvider } from '../src/discovery'
declare const legacyComputer: ComputerDiscovery
declare const legacyBrowsers: BrowserProvider
const legacy = createLegacyCUAFacade({
  computer: legacyComputer,
  setupBrowser: async () => ({ browsers: legacyBrowsers, documentation: { id: 'docs' } })
})
const legacyApps: ComputerDiscovery | null = legacy.computer
const legacyProvider: BrowserProvider | null = legacy.browsers
const legacyDocs: { id: string } | null = legacy.documentation
const legacyState: ReturnType<typeof import('../src/discovery').getState> = legacy.initialize()
void [legacyApps, legacyProvider, legacyDocs, legacyState]
import {
  createDelayedAction,
  createLazyEvaluator,
  enumerate,
  invariant,
  sleep
} from '../src/core/declared-helpers.js'
const delayedTyped: (value: number, text: string) => void = createDelayedAction(
  (_value: number, _text: string) => {}
)
const lazyTyped: (value: number) => string = createLazyEvaluator((value: number) => String(value))
const indexedTyped: Generator<readonly [number, string], void, unknown> = enumerate(['a'])
const sleepingTyped: Promise<unknown> = sleep(1)
declare const asyncIterable: AsyncIterable<Promise<string>>
const asyncIndexedTyped: AsyncGenerator<readonly [number, string], void, unknown> =
  enumerate.async(asyncIterable)
function narrowed(value: string | undefined): string {
  invariant(value, 'required')
  return value
}
// @ts-expect-error delayed parameters preserve callback tuple
delayedTyped('bad', 'text')
void [lazyTyped, indexedTyped, sleepingTyped, asyncIndexedTyped, narrowed]
