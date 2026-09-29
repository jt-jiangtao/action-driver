// @vitest-environment node
import { test, expect, vi } from 'vitest'
import { PerformanceSpans } from '../../src/service-performance-spans'
import { originalDocumentation } from '../original-service'
test('command spans filter values and preserve command/result attributes for every original descriptor', async () => {
  const base = await originalDocumentation(),
    spans = new PerformanceSpans()
  try {
    for (const type of [...Object.keys(base.baselineSpanCommands), 'unknown']) {
      async function exercise(api: any) {
        const events: any[] = []
        vi.stubGlobal('nodeRepl', {
          telemetry: {
            startSpan: (...args: any[]) => {
              events.push(['start', ...args])
              return { end: (...args: any[]) => events.push(['end', ...args]) }
            }
          }
        })
        const cyclic: any = { text: 'hello', array: ['world'] }
        cyclic.self = cyclic
        const result = await api.withCommandTelemetry(
          type,
          {
            tab_id: '12',
            timeout_ms: '100',
            url: 'https://u:p@example.com/path?secret',
            state: 'load'
          },
          async () => {
            events.push([
              'current',
              api.currentCommandAttrs(),
              api.currentPlaywrightOperation('fallback')
            ])
            return type === 'dom_cua_get_visible_dom'
              ? 'text'
              : {
                  dom_snapshot: 'first\nsecond',
                  value: cyclic,
                  values: cyclic,
                  results: [{ content: 'page' }]
                }
          }
        )
        return { events, result: type === 'dom_cua_get_visible_dom' ? result : 'result' }
      }
      expect(await exercise(spans), type).toEqual(await exercise(base.baselinePerformanceSpans))
    }
  } finally {
    vi.unstubAllGlobals()
  }
})
test('host span delegation and fallback error reporting preserve errors and cannot leak parent command context', async () => {
  const base = await originalDocumentation()
  try {
    async function exercise(api: any, delegated: boolean) {
      const events: any[] = []
      vi.stubGlobal('nodeRepl', {
        telemetry: delegated
          ? {
              withSpan: async (name: any, attrs: any, run: any, options: any) => {
                events.push([name, attrs, Object.keys(options)])
                return await run()
              }
            }
          : { startSpan: () => ({ end: (value: any) => events.push(value) }) }
      })
      let error
      try {
        await api.withSpan(
          'test',
          { valid: 1, secret: { value: 'hidden' }, missing: undefined },
          async () => {
            throw TypeError('failed')
          }
        )
      } catch (e: any) {
        error = { name: e.name, message: e.message }
      }
      return {
        events,
        error,
        current: api.currentCommandAttrs(),
        operation: api.currentPlaywrightOperation('outside')
      }
    }
    for (const delegated of [true, false])
      expect(await exercise(new PerformanceSpans(), delegated)).toEqual(
        await exercise(base.baselinePerformanceSpans, delegated)
      )
  } finally {
    vi.unstubAllGlobals()
  }
})
