import { pressLocator } from './service-playwright-press.js'
import { evaluateReadonly } from './service-readonly-evaluate.js'
import { waitForLoadState, waitForUrl } from './service-page-waits.js'
import { setFileChooserFiles, waitForFileChooser } from './service-file-chooser.js'
import { playwrightDomSnapshot } from './service-playwright-snapshot.js'
import { downloadLocatorMedia } from './service-playwright-media-download.js'
import { fillLocator } from './service-playwright-fill.js'
import { pressSequentially } from './service-playwright-sequential.js'
import type { PlaywrightInput } from './service-playwright-input.js'
interface Params {
  tab_id: number
  selector: string
  timeout_ms?: number | undefined
  name?: string
  relative_selector?: string
  selections?: unknown[]
  checked?: boolean
  state?: string
  button?: string
  force?: boolean
  modifiers?: string[]
}
interface Context {
  playwright: PlaywrightInput
}
/** Concrete locator handlers. Native clipboard/typing and readonly evaluation are separate handlers. */
export const playwrightCommandHandlers = {
  playwright_wait_for_file_chooser: waitForFileChooser,
  playwright_file_chooser_set_files: setFileChooserFiles,
  playwright_evaluate: evaluateReadonly,
  playwright_wait_for_load_state: async (
    params: { tab_id: number | string; state?: 'load' | 'domcontentloaded' | 'networkidle'; timeout_ms?: number; max?: number },
    context: Parameters<typeof waitForLoadState>[3]
  ) => {
    const limit = params.max || 3000
    const timeoutMs = Math.min(Math.max(0, typeof params.timeout_ms === 'number' ? params.timeout_ms : 3000), limit)
    await waitForLoadState(params.tab_id, params.state, timeoutMs, context)
    return {}
  },
  playwright_wait_for_timeout: async (params: { tab_id: number | string; timeout_ms: number }) => {
    const id = Number(params.tab_id)
    if (!Number.isInteger(id) || id <= 0) throw Error('Expected a positive integer')
    await new Promise((resolve) => setTimeout(resolve, params.timeout_ms))
    return {}
  },
  playwright_wait_for_url: waitForUrl,
  playwright_locator_press: pressLocator,
  playwright_dom_snapshot: playwrightDomSnapshot,
  playwright_locator_download_media: downloadLocatorMedia,
  playwright_download_path: async (
    params: { tab_id: number; download_id?: string },
    context: { downloads: { getPath(id: string): string } }
  ) => {
    const id = Number(params.tab_id)
    if (!Number.isInteger(id) || id <= 0) throw Error('Expected a positive integer')
    if (typeof params.download_id !== 'string' || params.download_id.length === 0)
      throw Error('playwright_download_path requires a download_id')
    return { path: context.downloads.getPath(params.download_id) }
  },
  playwright_wait_for_download: async (
    params: { tab_id: number; timeout_ms?: number },
    context: {
      downloads: {
        withDownload<T>(id: number, run: () => Promise<T>): Promise<T>
        enableDownload(id: number): Promise<unknown>
        waitForDownload(id: number, timeoutMs: number): Promise<{ id: string }>
        disableDownload(id: number): Promise<unknown>
      }
    }
  ) => {
    const id = Number(params.tab_id)
    if (!Number.isInteger(id) || id <= 0) throw Error('Expected a positive integer')
    return await context.downloads.withDownload(id, async () => {
      const timeoutMs = Math.min(
        Math.max(0, typeof params.timeout_ms === 'number' ? params.timeout_ms : 120000),
        120000
      )
      await context.downloads.enableDownload(id)
      try {
        return { download_id: (await context.downloads.waitForDownload(id, timeoutMs)).id }
      } finally {
        await context.downloads.disableDownload(id)
      }
    })
  },
  playwright_locator_fill: fillLocator,
  playwright_locator_press_sequentially: pressSequentially,
  playwright_locator_click: async (params: Params, context: Context) => {
    await context.playwright.clickLocator(params, 1)
    return {}
  },
  playwright_locator_dblclick: async (params: Params, context: Context) => {
    await context.playwright.clickLocator(params, 2)
    return {}
  },
  playwright_locator_count: async (params: Params, context: Context) => ({
    count: await context.playwright.evaluateOnPlaywrightSelectorAll(
      params.tab_id,
      params.selector,
      (elements: any[]) => elements.length
    )
  }),
  playwright_locator_is_enabled: async (params: Params, context: Context) => ({
    value: await context.playwright.readElementState(params, 'enabled')
  }),
  playwright_locator_is_visible: async (params: Params, context: Context) => ({
    value: await context.playwright.readElementState(params, 'visible')
  }),
  playwright_locator_get_attribute: async (params: Params, context: Context) => {
    if (typeof params.name !== 'string' || !params.name)
      throw Error('playwright_locator_get_attribute requires name')
    return {
      value: await context.playwright.evaluateOnPlaywrightSelector(
        params.tab_id,
        params.selector,
        (element: any, injected: any, arg: any) =>
          arg.name.toLowerCase() === 'value' && injected.isProtectedCredentialField(element)
            ? null
            : element.getAttribute(arg.name),
        { arg: { name: params.name }, timeoutMs: params.timeout_ms }
      )
    }
  },
  playwright_locator_inner_text: async (params: Params, context: Context) => ({
    value: await context.playwright.evaluateOnPlaywrightSelector(
      params.tab_id,
      params.selector,
      (element: any) => ('innerText' in element ? String(element.innerText) : ''),
      { timeoutMs: params.timeout_ms }
    )
  }),
  playwright_locator_all_text_contents: async (params: Params, context: Context) => ({
    values: await context.playwright.evaluateOnPlaywrightSelectorAll(
      params.tab_id,
      params.selector,
      (elements: any[]) =>
        elements.map((element) =>
          typeof element.textContent === 'string' ? element.textContent : ''
        ),
      { timeoutMs: params.timeout_ms }
    )
  }),
  playwright_locator_text_content: async (params: Params, context: Context) => ({
    value: await context.playwright.evaluateOnPlaywrightSelector(
      params.tab_id,
      params.selector,
      (element: any) => element.textContent,
      { timeoutMs: params.timeout_ms }
    )
  }),
  playwright_locator_read_all: async (params: Params, context: Context) => ({
    values: await context.playwright.evaluateOnPlaywrightSelectorAll(
      params.tab_id,
      params.selector,
      (elements: any[], injected: any, arg: any) => {
        const read = (element: any) => ({
          attributes: Object.fromEntries(
            Array.from(element.attributes as Iterable<{ name: string; value: string }>)
              .filter(
                (attribute) =>
                  attribute.name.toLowerCase() !== 'value' ||
                  !injected.isProtectedCredentialField(element)
              )
              .map((attribute) => [attribute.name, attribute.value])
          ),
          inner_text: 'innerText' in element ? String(element.innerText) : '',
          text_content: element.textContent
        })
        if (!arg.relativeSelector) return elements.map(read)
        const parsed = injected.parseSelector(arg.relativeSelector)
        return elements.map((element) => {
          const found = injected.querySelectorAll(parsed, element)
          return found[0] ? read(found[0]) : null
        })
      },
      { arg: { relativeSelector: params.relative_selector }, timeoutMs: params.timeout_ms }
    )
  }),
  playwright_locator_select_option: async (params: Params, context: Context) => {
    await context.playwright.evaluateOnPlaywrightSelector(
      params.tab_id,
      params.selector,
      (element: any, injected: any, arg: any) => {
        const enabled = injected.elementState(element, 'enabled')
        if (enabled.received === 'error:notconnected') throw Error('Element is not connected')
        if (!enabled.matches) throw Error('Element is not enabled')
        const result = injected.selectOptions(element, arg.selections)
        if (typeof result === 'string' && result.startsWith('error:')) throw Error(result)
        return true
      },
      { arg: { selections: params.selections ?? [] }, timeoutMs: params.timeout_ms }
    )
    return {}
  },
  playwright_locator_set_checked: async (params: Params, context: Context) => {
    if (typeof params.checked !== 'boolean')
      throw Error('playwright_locator_set_checked requires checked')
    const state = (await context.playwright.readCheckedState(params)) as {
      checked: boolean
      isRadio: boolean
    }
    if (state.checked === params.checked) return {}
    if (state.isRadio && !params.checked) throw Error('Cannot uncheck a radio button')
    await context.playwright.clickLocator(params, 1)
    if (
      ((await context.playwright.readCheckedState(params)) as { checked: boolean }).checked !==
      params.checked
    )
      throw Error(`Click did not change checked state to ${String(params.checked)}`)
    return {}
  },
  playwright_locator_wait_for: async (params: Params, context: Context) => {
    const state = params.state ?? 'visible'
    if (!['attached', 'detached', 'visible', 'hidden'].includes(state))
      throw Error(`Unsupported waitFor state: ${String(state)}`)
    await context.playwright.evaluateOnPlaywrightSelectorAll(
      params.tab_id,
      params.selector,
      (elements: any[], injected: any, arg: any) => {
        const element = elements[0] ?? null
        if (arg.state === 'attached') {
          if (element) return true
          throw Error('Element is not attached')
        }
        if (arg.state === 'detached') {
          if (!element) return true
          throw Error('Element is still attached')
        }
        if (!element) {
          if (arg.state === 'hidden') return true
          throw Error('Element is not attached')
        }
        const state = injected.elementState(element, arg.state)
        if (state.received === 'error:notconnected') throw Error('Element is not connected')
        if (state.matches) return true
        throw Error('Element is not ' + arg.state)
      },
      { arg: { state }, timeoutMs: params.timeout_ms }
    )
    return {}
  }
}
