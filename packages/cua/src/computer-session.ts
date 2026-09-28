import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { getApps, getState, type ComputerDiscovery } from './discovery.js'
import { createSessionLifecycle, type SessionLifecycle } from './session-lifecycle.js'

type Input = { app: string; [key: string]: unknown }
export interface MacComputer extends ComputerDiscovery {
  target: 'mac'
  get_app_state(
    input: Input
  ): Promise<{ app: string; text: string; screenshot: { url: string } | null }>
  click(input: Input): Promise<void>
  drag(input: Input): Promise<void>
  paste(input: Input): Promise<void>
  press_key(input: Input): Promise<void>
  scroll(input: Input): Promise<void>
  select_text(input: Input): Promise<void>
  set_value(input: Input): Promise<void>
  type_text(input: Input): Promise<void>
  perform_secondary_action(input: Input): Promise<void>
}
export interface SessionHost {
  env?: Record<string, string | undefined>
  requestMeta?: unknown
  write?(text: string, itemId: string): void | Promise<void>
  emitImage?(image: { bytes: Uint8Array; mimeType: string }): void | Promise<void>
}
type EmitOptions = { emit?: boolean }
type StateOptions = EmitOptions & { disableDiffing?: boolean }
type Target = number | [number, number]
const targetInput = (target: Target) =>
  Array.isArray(target) ? { x: target[0], y: target[1] } : { element_index: target }
const optional = (name: string, value: unknown) => (value === undefined ? {} : { [name]: value })
async function screenshotBytes(url: string): Promise<Uint8Array> {
  return url.startsWith('data:')
    ? Uint8Array.from(Buffer.from(url.split(',')[1] ?? '', 'base64'))
    : readFile(fileURLToPath(url))
}

export async function createComputerSession({
  computer,
  getHost = () => undefined,
  lifecycle = createSessionLifecycle(getHost)
}: {
  computer: MacComputer
  getHost?: () => SessionHost | undefined
  lifecycle?: SessionLifecycle
}) {
  if (computer.target !== 'mac') throw new Error('Computer sessions currently support macOS only.')
  function emit(state?: unknown, rewrite = false) {
    return rewrite ? lifecycle.rewriteDocumentation() : lifecycle.emit(state)
  }
  async function getApp(reference: string) {
    if (typeof reference !== 'string')
      throw new Error('macOS getApp requires an app name, path, or bundle ID.')
    const initial = await computer.get_app_state({ app: reference, disableDiff: true })
    const app = initial.app
    await emit(initial.text)
    const state = (options?: StateOptions) =>
      computer.get_app_state({ app, ...optional('disableDiff', options?.disableDiffing) })
    async function image(url: string, options?: EmitOptions) {
      const bytes = await screenshotBytes(url)
      if (options?.emit !== false) await getHost()?.emitImage?.({ bytes, mimeType: 'image/png' })
      return bytes
    }
    return {
      async getAXState(options?: StateOptions) {
        const result = await state(options)
        if (options?.emit !== false) await getHost()?.write?.(result.text, 'cua.state')
        return result.text
      },
      async getScreenshot(options?: EmitOptions) {
        const result = await computer.get_app_state({ app })
        if (result.screenshot === null) throw new Error(`Screenshot unavailable for ${app}.`)
        return image(result.screenshot.url, options)
      },
      async getAXStateAndScreenshot(options?: StateOptions) {
        const result = await state(options)
        if (options?.emit !== false) await getHost()?.write?.(result.text, 'cua.state')
        return result.screenshot === null
          ? { state: result.text }
          : { state: result.text, screenshot: await image(result.screenshot.url, options) }
      },
      click(target: Target, options?: { mouseButton?: string; clickCount?: number }) {
        return computer.click({
          app,
          ...targetInput(target),
          ...optional('mouse_button', options?.mouseButton),
          ...optional('click_count', options?.clickCount)
        })
      },
      drag(from: [number, number], to: [number, number]) {
        return computer.drag({ app, from_x: from[0], from_y: from[1], to_x: to[0], to_y: to[1] })
      },
      paste(text: string, options?: { format?: string }) {
        return computer.paste({ app, text, format: options?.format ?? 'text' })
      },
      pressKey(key: string) {
        return computer.press_key({ app, key })
      },
      scroll(target: Target, direction: string, pages?: number) {
        if (typeof pages === 'object') throw new Error('macOS scroll accepts pages, not pixels.')
        return computer.scroll({
          app,
          ...targetInput(target),
          direction,
          ...optional('pages', pages)
        })
      },
      selectText(
        index: number,
        text: string,
        options?: { prefix?: string; suffix?: string; selectionType?: string }
      ) {
        return computer.select_text({
          app,
          element_index: index,
          text,
          ...optional('prefix', options?.prefix),
          ...optional('suffix', options?.suffix),
          ...optional('selection_type', options?.selectionType)
        })
      },
      setValue(index: number, value: string) {
        return computer.set_value({ app, element_index: index, value })
      },
      typeText(text: string) {
        return computer.type_text({ app, text })
      },
      performSecondaryAction(index: number, action: string) {
        return computer.perform_secondary_action({ app, element_index: index, action })
      }
    }
  }
  await emit()
  return {
    computer,
    getApp,
    async listApps(options?: EmitOptions) {
      const result = await getApps(computer)
      await emit(options?.emit === false ? undefined : result)
      return result
    },
    async getState(options?: EmitOptions) {
      const result = await getState({ computer })
      await emit(options?.emit === false ? undefined : result)
      return result
    },
    rewriteDocumentation: () => emit(undefined, true)
  }
}
