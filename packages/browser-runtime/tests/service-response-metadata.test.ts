// @vitest-environment node
import { test, expect } from 'vitest'
import {
  surfaceMetadata,
  setBrowserResponseMetadata,
  collectBrowserResponseMetadata
} from '../src/service-response-metadata'
import { BrowserTelemetry } from '../src/service-telemetry'
import { originalDocumentation } from './original-service'
test('response metadata filters supported details and strips URL credentials, queries and fragments', async () => {
  const base = await originalDocumentation()
  for (const url of [
    'https://user:password@example.com/page?secret=1#hash',
    'file:///private',
    'invalid',
    undefined
  ]) {
    const details = {
      browserId: 'id',
      browserFamily: 'chrome',
      params: { url: 'https://fallback.test?p=1' },
      currentUrl: url,
      screenshot: { tabId: '1', url: 'image' },
      webMcpCalls: [],
      sessionEnded: false,
      ignored: 'private'
    }
    const a: any[] = [],
      b: any[] = []
    setBrowserResponseMetadata({ setResponseMeta: (value) => a.push(value) }, 'chrome', details)
    base.baselineSetResponseMetadata(
      { setResponseMeta: (value: any) => b.push(value) },
      'chrome',
      details
    )
    expect(a).toEqual(b)
    expect(
      surfaceMetadata({
        backend: 'chrome',
        currentUrl: url,
        params: details.params,
        surfaceDetails: { custom: true },
        cloudBrowserHandoff: { target: 'cloud' }
      })
    ).toEqual(
      base.baselineSurfaceMetadata({
        backend: 'chrome',
        currentUrl: url,
        params: details.params,
        surfaceDetails: { custom: true },
        cloudBrowserHandoff: { target: 'cloud' }
      })
    )
  }
})
test('collected tabs and screenshot metadata omit sensitive URL parts and all observations after native credential use', async () => {
  const base = await originalDocumentation()
  async function exercise(original: boolean, backend: string, blocked: boolean, fail: boolean) {
    base.resetCredentialState()
    const calls: any[] = [],
      clientInfo = {
        type: backend === 'chrome' ? 'extension' : 'iab',
        family: 'chrome',
        metadata: { extensionInstanceId: 'extension' }
      },
      tabs = [
        {
          id: 1,
          title: ' Title ',
          url: 'https://user:pw@example.com:444/path?secret=1',
          faviconUrl: 'https://icon.test/a?x=1',
          active: true
        },
        { id: 2, url: 'https://user.test', sessionControlled: false }
      ]
    const cdp = {
      withInternalScreencast: async () => undefined,
      call: async (_id: number, method: string) => {
        if (method === 'Page.getLayoutMetrics')
          return { cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 500, clientHeight: 400 } }
        return { data: 'image' }
      }
    }
    const context = {
      browserId: 'browser',
      clientInfo,
      credentialObservationGate: {
        usedNativeCredentials: blocked,
        observe: async (run: any) => await run()
      },
      cdp,
      tabs: {
        list: async () => {
          if (fail) throw Error('tabs unavailable')
          return tabs
        },
        getActive: async () => tabs[0]
      }
    }
    const runtime = { env: {}, platform: 'darwin' },
      telemetry = new BrowserTelemetry({
        logEvent: (_host: any, ...args: any[]) =>
          calls.push([args[0].replace(/^codex_/, ''), ...args.slice(1)])
      } as any)
    base.configureTelemetry({
      logEvent: (_host: any, ...args: any[]) =>
        calls.push([args[0].replace(/^codex_/, ''), ...args.slice(1)])
    })
    const input = {
      backend,
      commandSucceeded: true,
      commandType: 'close_tab',
      context,
      params: { tab_id: '1' },
      result: {},
      runtime
    }
    return {
      result: original
        ? await base.baselineCollectResponseMetadata(input)
        : await collectBrowserResponseMetadata(input as any, telemetry as any),
      calls
    }
  }
  for (const backend of ['chrome', 'iab'])
    for (const blocked of [false, true])
      for (const fail of [false, true])
        expect(await exercise(false, backend, blocked, fail)).toEqual(
          await exercise(true, backend, blocked, fail)
        )
})
