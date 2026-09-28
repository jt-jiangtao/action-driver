// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { BrowserTelemetry } from '../src/service-telemetry.js'
import { botDetectionEvent, miscCommandHandlers } from '../src/service-misc-commands.js'
import { originalDocumentation } from './original-service.js'

const backend = { type: 'extension', family: 'chrome' }

describe('remaining browser service commands', () => {
  test('screenshot command uses CSS pixels and retains the original CDP response', async () => {
    const base = await originalDocumentation()
    const exercise = async (run: (params: any, context: any) => Promise<any>) => {
      const calls: unknown[] = [], context = {
        cdp: {
          call: async (_id: number, method: string, params?: unknown) => {
            calls.push([method, params])
            if (method === 'Runtime.evaluate') return { result: { value: 2 } }
            if (method === 'Page.captureScreenshot') return { data: 'encoded' }
            throw Error(`Unexpected CDP method: ${method}`)
          }
        }
      }
      return { result: await run({ tab_id: '7', cropX: 1, cropY: 2, cropWidth: 30, cropHeight: 40 }, context), calls }
    }
    expect(await exercise(miscCommandHandlers.tab_screenshot)).toEqual(await exercise(base.baselineScreenshot))
  })

  test('navigation command forwards the approval and selected tab to the safe navigation layer', async () => {
    const base = await originalDocumentation()
    const exercise = async (run: (params: any, context: any, approval: Promise<unknown>) => Promise<any>) => {
      const calls: unknown[] = []
      const context = {
        followSessionTab: async (id: number) => { calls.push(['follow', id]) },
        documentResponses: {},
        getCurrentSessionId: () => 'session',
        cdp: { readDocumentState: async (id: number) => { calls.push(['read', id]); throw Error('read failed') } }
      }
      try { await run({ tab_id: '7', url: 'https://example.test/' }, context, Promise.resolve()) }
      catch (error) { return { error: (error as Error).message, calls } }
      return { error: 'unexpected success', calls }
    }
    expect(await exercise(miscCommandHandlers.navigate_tab_url)).toEqual(await exercise(base.baselineNavigateUrl))
  })

  test('manual takeover marks only supported CDP tabs and obeys runtime capability filtering', async () => {
    const base = await originalDocumentation()
    const exercise = async (run: (params: any, context: any) => Promise<any>, disabled: boolean) => {
      const marks: unknown[] = [], context = {
        clientInfo: {
          name: 'Cloud Browser', type: 'cdp',
          capabilities: { tab: [{ id: 'browserAuth' }] }
        },
        runtime: { env: disabled ? { BROWSER_USE_DISABLE_TAB_CAPABILITIES: 'browserAuth' } : {} },
        tabs: { get: async (id: number) => ({ id }), mark: async (...args: unknown[]) => { marks.push(args) } }
      }
      try { return { result: await run({ tab_id: '7' }, context), marks } }
      catch (error) { return { error: (error as Error).message, marks } }
    }
    for (const disabled of [false, true])
      expect(await exercise(miscCommandHandlers.tab_manual_handoff_request, disabled))
        .toEqual(await exercise(base.baselineManualHandoff, disabled))
  })

  test('bot report event matches original hostname and turn metadata across backends', async () => {
    const base = await originalDocumentation()
    for (const [, mapped] of [['extension', 'chrome'], ['iab', 'iab'], ['cdp', 'cdp']] as const)
      for (const url of ['https://sub.example.test/path?token=secret', 'about:blank', undefined]) {
        const input = {
          backend: mapped, reason: 'challenge_loop',
          turnMetadata: { session_id: 'session', thread_id: 'thread', turn_id: 'turn', model: 'model' }, url
        }
        expect(botDetectionEvent(input)).toEqual(base.baselineBotEvent(input))
      }
  })

  test('bot handler reports original result and telemetry event without exposing the URL path', async () => {
    const base = await originalDocumentation()
    const exercise = async (original: boolean) => {
      const calls: unknown[] = [], sdk = {
        logEvent: (_host: unknown, name: string, value: unknown, metadata: unknown) => calls.push([name, value, metadata])
      }
      const telemetry = original ? base.configureTelemetry(sdk) : new BrowserTelemetry(sdk as any)
      const context = {
        clientInfo: backend,
        runtime: { platform: 'darwin', env: {}, requestMeta: { 'x-codex-turn-metadata': { session_id: 'session', turn_id: 'turn' } } },
        cdp: {
          readDocumentState: async () => ({ href: 'https://login.example.test/path?secret=1' }),
          currentTopLevelUrl: () => undefined
        }
      }
      const params = { browser_id: 'browser', tab_id: '7', reason: 'captcha_failed' }
      const result = original
        ? await base.baselineBotReport(params, context)
        : await miscCommandHandlers.tab_bot_detection_report(params, context as any, telemetry)
      return { result, calls }
    }
    expect(await exercise(false)).toEqual(await exercise(true))
  })
})
