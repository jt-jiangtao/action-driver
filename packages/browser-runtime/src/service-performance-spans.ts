import { AsyncLocalStorage } from 'node:async_hooks'
interface Span {
  end(options: { attrs: Record<string, unknown>; status: string }): unknown
}
interface SpanOptions<T> {
  resultAttrs?: ((result: T) => Record<string, unknown>) | undefined
}
interface Telemetry {
  startSpan?(name: string, attrs: Record<string, unknown>): Span
  withSpan?<T>(
    name: string,
    attrs: Record<string, unknown>,
    run: () => Promise<T>,
    options: SpanOptions<T>
  ): Promise<T>
}
interface Descriptor {
  name: string
  action?: string
  operation?: string
  attrs?: (params: unknown) => Record<string, unknown>
  resultAttrs?: (result: unknown) => Record<string, unknown>
}
function property(value: unknown, key: string) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined
}
function string(value: unknown, key: string) {
  const result = property(value, key)
  return typeof result === 'string' ? result : undefined
}
function number(value: unknown, key: string) {
  const raw = property(value, key),
    result = typeof raw === 'string' ? Number(raw) : raw
  return typeof result === 'number' && Number.isFinite(result) ? result : undefined
}
function scalarAttributes(attrs: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(attrs).filter(([, value]) =>
      ['string', 'number', 'boolean'].includes(typeof value)
    )
  )
}
function characters(value: unknown, seen = new Set<unknown>()): number {
  if (typeof value === 'string') return value.length
  if (value == null || typeof value !== 'object' || seen.has(value)) return 0
  seen.add(value)
  return (Array.isArray(value) ? value : Object.values(value)).reduce<number>(
    (sum, item) => sum + characters(item, seen),
    0
  )
}
const textCount = (value: string) => ({ 'browser_use.result.character_count': value.length })
const valueCount = (value: unknown) => ({ 'browser_use.result.character_count': characters(value) })
function origin(value: string | undefined) {
  if (value == null) return
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : url.protocol.replace(/:$/, '')
  } catch {
    return
  }
}
const descriptors: Record<string, Descriptor> = {
  cua_click: { action: 'click', name: 'browser_use.tab.click' },
  cua_double_click: { action: 'dblclick', name: 'browser_use.tab.click' },
  cua_type: { action: 'type', name: 'browser_use.tab.type' },
  navigate_tab_url: {
    attrs: (params) => ({ 'url.origin': origin(string(params, 'url')) }),
    name: 'browser_use.tab.goto'
  },
  dom_cua_get_visible_dom: {
    name: 'browser_use.command.execute',
    resultAttrs: (result) => textCount(typeof result === 'string' ? result : '')
  },
  playwright_dom_snapshot: {
    attrs: () => ({
      'browser_use.playwright.snapshot.mode': 'ai',
      'browser_use.playwright.snapshot.target': 'body_or_document'
    }),
    name: 'browser_use.playwright.dom_snapshot',
    operation: 'dom_snapshot',
    resultAttrs: (result) => {
      const text = string(result, 'dom_snapshot') ?? ''
      return {
        'browser_use.playwright.snapshot.length': text.length,
        'browser_use.playwright.snapshot.line_count': text === '' ? 0 : text.split('\n').length
      }
    }
  },
  playwright_evaluate: {
    name: 'browser_use.command.execute',
    resultAttrs: (result) => valueCount(property(result, 'value'))
  },
  playwright_locator_all_text_contents: {
    name: 'browser_use.command.execute',
    resultAttrs: (result) => valueCount(property(result, 'values'))
  },
  playwright_locator_click: { action: 'click', name: 'browser_use.tab.click' },
  playwright_locator_dblclick: { action: 'dblclick', name: 'browser_use.tab.click' },
  playwright_locator_fill: { action: 'fill', name: 'browser_use.tab.type' },
  playwright_locator_get_attribute: {
    name: 'browser_use.command.execute',
    resultAttrs: (result) => textCount(string(result, 'value') ?? '')
  },
  playwright_locator_inner_text: {
    name: 'browser_use.command.execute',
    resultAttrs: (result) => textCount(string(result, 'value') ?? '')
  },
  playwright_locator_press: { action: 'press', name: 'browser_use.tab.type' },
  playwright_locator_press_sequentially: {
    action: 'press_sequentially',
    name: 'browser_use.tab.type'
  },
  playwright_locator_read_all: {
    name: 'browser_use.command.execute',
    resultAttrs: (result) => valueCount(property(result, 'values'))
  },
  playwright_locator_set_checked: { action: 'set_checked', name: 'browser_use.tab.click' },
  playwright_locator_text_content: {
    name: 'browser_use.command.execute',
    resultAttrs: (result) => textCount(string(result, 'value') ?? '')
  },
  tab_screenshot: { name: 'browser_use.tab.screenshot' },
  tabs_content: {
    name: 'browser_use.command.execute',
    resultAttrs: (result) => {
      const results = property(result, 'results')
      return valueCount(
        (Array.isArray(results) ? results : []).map((item) => string(item, 'content') ?? '')
      )
    }
  },
  playwright_wait_for_load_state: {
    attrs: (params) => ({ 'load.state': string(params, 'state') ?? 'load' }),
    name: 'browser_use.tab.wait_for_load_state'
  },
  playwright_wait_for_timeout: { name: 'browser_use.tab.wait_for_timeout' }
}
export class PerformanceSpans {
  private active = new AsyncLocalStorage<{ commandType: string; playwrightOperation: string }>()
  constructor(
    private telemetry: () => Telemetry | undefined = () =>
      (globalThis as { nodeRepl?: { telemetry?: Telemetry } }).nodeRepl?.telemetry
  ) {}
  async withSpan<T>(
    name: string,
    attributes: Record<string, unknown>,
    run: () => Promise<T>,
    options: SpanOptions<T> = {}
  ): Promise<T> {
    const attrs = scalarAttributes(attributes),
      telemetry = this.telemetry()
    if (telemetry?.withSpan) return await telemetry.withSpan(name, attrs, run, options)
    let span: Span = { end() {} }
    try {
      span = this.telemetry()?.startSpan?.(name, scalarAttributes(attrs)) ?? span
    } catch {}
    const end = (attrs: Record<string, unknown>, status: string) => {
      try {
        span.end({ attrs, status })
      } catch {}
    }
    try {
      const result = await run()
      end(scalarAttributes(options.resultAttrs?.(result) ?? {}), 'ok')
      return result
    } catch (error) {
      end(
        { 'error.kind': error instanceof Error && error.name ? error.name : typeof error },
        'error'
      )
      throw error
    }
  }
  async withCommandTelemetry<T>(type: string, params: unknown, run: () => Promise<T>): Promise<T> {
    const descriptor = descriptors[type],
      context = { commandType: type, playwrightOperation: descriptor?.operation ?? type }
    return await this.active.run(
      context,
      async () =>
        await this.withSpan(
          descriptor?.name ?? 'browser_use.command.execute',
          {
            'browser.action': descriptor?.action,
            'browser_use.command.type': type,
            'browser_use.playwright.operation': descriptor?.operation,
            'browser_use.tab.id': number(params, 'tab_id'),
            'tab.id': number(params, 'tab_id'),
            timeout_ms: number(params, 'timeout_ms'),
            ...descriptor?.attrs?.(params)
          },
          run,
          {
            resultAttrs: descriptor?.resultAttrs as
              | ((result: T) => Record<string, unknown>)
              | undefined
          }
        )
    )
  }
  currentCommandAttrs(): Record<string, unknown> {
    const context = this.active.getStore()
    return context == null ? {} : { 'browser_use.command.type': context.commandType }
  }
  currentPlaywrightOperation(fallback: string) {
    return this.active.getStore()?.playwrightOperation ?? fallback
  }
}
