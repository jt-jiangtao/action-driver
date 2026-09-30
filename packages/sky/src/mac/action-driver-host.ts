import { randomUUID } from 'node:crypto'
import type { ComputerHelperRequest } from '@action-driver/runtime-contracts'
import { windowResult } from './window-result.js'

export interface ProductComputerHost {
  request(input: ComputerHelperRequest, signal?: AbortSignal): Promise<unknown>
}

export interface ProductSkyOptions {
  sessionId: string
  signal?: AbortSignal | undefined
  requestId?: (() => string) | undefined
  now?: (() => number) | undefined
}

type App = { app: string }
type Position = App & { element_index?: number; x?: number; y?: number }

/** Adapt the Sky-shaped macOS methods to Action-Driver's versioned helper protocol. */
export function createProductSky(host: ProductComputerHost, options: ProductSkyOptions) {
  if (!options.sessionId) throw new Error('SKY_SESSION_REQUIRED')
  const nextId = options.requestId ?? randomUUID
  const now = options.now ?? Date.now
  const delivered = new Set<string>()
  let started: Promise<void> | undefined
  let active = false
  let closed = false
  let closing: Promise<void> | undefined

  const send = async (request: Record<string, unknown> & { operation: ComputerHelperRequest['operation'] },
    signal: AbortSignal | null | undefined = options.signal,
    allowClosing = false): Promise<unknown> => {
    if (closed && !allowClosing) throw new Error('SKY_HOST_CLOSED')
    if (signal?.aborted) throw new Error('CANCELLED: request aborted')
    return host.request({
      ...request,
      version: 1,
      requestId: nextId(),
      deadlineUnixMs: now() + 120_000
    } as ComputerHelperRequest, signal ?? undefined)
  }
  const start = async () => {
    if (closed) throw new Error('SKY_HOST_CLOSED')
    if (!started) {
      started = send({ operation: 'session-start', sessionId: options.sessionId }).then(() => {
        active = true
      })
      void started.catch(() => { started = undefined })
    }
    await started
  }
  const act = async (app: string, action: Record<string, unknown>) => {
    await start()
    return send({ operation: 'act', sessionId: options.sessionId, app, action } as never)
  }
  const unsupported = async (): Promise<never> => {
    throw new Error('SKY_CAPABILITY_UNAVAILABLE: helper does not support this method')
  }

  return {
    target: 'mac' as const,
    async list_apps() {
      const result = await send({ operation: 'list-apps' }) as { apps?: unknown }
      if (!Array.isArray(result?.apps)) throw new Error('INVALID_REQUEST: helper list-apps result')
      return result.apps
    },
    async get_app_state(input: App & { disableDiff?: boolean }) {
      await start()
      const result = await send({
        operation: 'app-state', sessionId: options.sessionId, app: input.app,
        maxElements: 300, maxDepth: 12, disableDiff: input.disableDiff, screenshot: true
      } as never) as {
        app?: string; text?: string; appSpecificInstructions?: string
        screenshot?: { mimeType?: string; base64?: string }
      }
      const screenshot = result.screenshot
      if (screenshot && (screenshot.mimeType !== 'image/png' || typeof screenshot.base64 !== 'string'))
        throw new Error('INVALID_REQUEST: helper screenshot result')
      return windowResult(input.app, {
        app: result.app ?? input.app,
        ...(result.appSpecificInstructions === undefined
          ? {} : { appSpecificInstructions: result.appSpecificInstructions }),
        skyshot: { text: result.text as string, screenshot: screenshot
          ? { url: `data:image/png;base64,${screenshot.base64}` } : null }
      }, delivered)
    },
    click(input: Position & { click_count?: number; mouse_button?: string }) {
      const mouseButton = input.mouse_button ?? 'left'
      const clickCount = input.click_count ?? 1
      return act(input.app, input.element_index === undefined
        ? { type: 'click', x: input.x, y: input.y, mouseButton, clickCount }
        : { type: 'click-element', elementIndex: input.element_index, mouseButton, clickCount })
    },
    drag(input: App & { from_x: number; from_y: number; to_x: number; to_y: number }) {
      return act(input.app, { type: 'drag', fromX: input.from_x, fromY: input.from_y,
        toX: input.to_x, toY: input.to_y })
    },
    paste(input: App & { text: string; format: 'text' | 'md' | 'html' }) {
      return act(input.app, { type: 'paste', text: input.text, format: input.format })
    },
    press_key(input: App & { key: string }) {
      return act(input.app, { type: 'key', key: input.key, modifiers: [] })
    },
    scroll(input: Position & { direction: 'up' | 'down' | 'left' | 'right'; pages?: number }) {
      const offset = (input.pages ?? 1) * 600
      const deltaX = input.direction === 'left' ? -offset : input.direction === 'right' ? offset : 0
      const deltaY = input.direction === 'up' ? -offset : input.direction === 'down' ? offset : 0
      return act(input.app, input.element_index === undefined
        ? { type: 'scroll', x: input.x, y: input.y, deltaX, deltaY }
        : { type: 'scroll', elementIndex: input.element_index, deltaX, deltaY })
    },
    select_text(input: App & { element_index: number; text: string; prefix?: string;
      suffix?: string; selection_type?: string }) {
      return act(input.app, { type: 'select-text', elementIndex: input.element_index,
        text: input.text, prefix: input.prefix, suffix: input.suffix,
        selectionType: input.selection_type })
    },
    set_value(input: App & { element_index: number; value: string }) {
      return act(input.app, { type: 'set-value', elementIndex: input.element_index, value: input.value })
    },
    type_text(input: App & { text: string }) {
      return act(input.app, { type: 'type', text: input.text })
    },
    perform_secondary_action(input: App & { element_index: number; action: string }) {
      return act(input.app, { type: 'secondary-action', elementIndex: input.element_index,
        action: input.action })
    },
    start_audio_recording: unsupported,
    stop_audio_recording: unsupported,
    close() {
      if (!closing) {
        closed = true
        closing = (async () => {
          try {
            if (started) {
              try { await started } catch { /* no helper session to end */ }
              if (active) await send({ operation: 'session-end', sessionId: options.sessionId }, null, true)
            }
          } finally { active = false }
        })()
      }
      return closing
    }
  }
}
