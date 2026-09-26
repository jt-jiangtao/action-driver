import { computerHelperRequest } from '@actiondriver/runtime-contracts'
import { z } from 'zod'

export type CodexCallContext = { taskId: string; sessionId: string; signal?: AbortSignal }
type Input = Record<string, unknown>
type Options = {
  invoke(input: Input, signal?: AbortSignal): Promise<unknown>
  onExecutedText?(context: CodexCallContext, text: string): void
  /** Text for the model's output, for results it has to verify itself. */
  onNotice?(context: CodexCallContext, text: string): void
  writeScreenshot(sessionId: string, bytes: Buffer, mimeType: string): Promise<string>
}

const stateSchema = z.object({
  app: z.string().min(1),
  text: z.string(),
  appSpecificInstructions: z.string().optional(),
  screenshot: z.object({ base64: z.string().min(1), mimeType: z.literal('image/png') }).optional()
})

/** Transport port for the original trusted sky/service; never exposed to model code. */
export function createCodexNativeClient(options: Options) {
  async function request(input: Input, context: CodexCallContext): Promise<unknown> {
    if (!context?.sessionId || !context.taskId)
      throw new Error('INVALID_REQUEST: trusted context required')
    if (context.signal?.aborted) throw new Error('CANCELLED: native call cancelled')
    const clean = JSON.parse(JSON.stringify(input)) as Input
    const validated = computerHelperRequest.safeParse({
      version: 1,
      requestId: 'validation',
      deadlineUnixMs: Date.now() + 30_000,
      ...clean
    })
    if (!validated.success) throw new Error(`INVALID_REQUEST: ${validated.error.message}`)
    return await options.invoke(clean, context.signal)
  }

  const act = async (input: Input, action: Input, context: CodexCallContext) => {
    const result = await request(
      { operation: 'act', app: input.app, sessionId: context.sessionId, action },
      context
    )
    if (
      typeof result === 'object' &&
      result !== null &&
      'executed' in result &&
      result.executed === true
    ) {
      const text =
        action.type === 'type' || action.type === 'paste'
          ? action.text
          : action.type === 'set-value'
            ? action.value
            : undefined
      if (typeof text === 'string') options.onExecutedText?.(context, text)
    } else if (
      typeof result === 'object' &&
      result !== null &&
      'delivered' in result &&
      result.delivered === true
    ) {
      // Delivered input has no receipt (D6 keyboard ruling, and an unconfirmed paste): it may not
      // have arrived, so it is not recorded as executed and the model is told to check.
      options.onNotice?.(
        context,
        '[ActionDriver] Input reached the app, but the app gave no confirmation it was received. ' +
          'Verify with getScreenshot() or getAXState() before relying on it.\n'
      )
    }
  }
  return {
    async listApps(context: CodexCallContext) {
      const result = await request({ operation: 'list-apps' }, context)
      const parsed = z
        .object({
          apps: z.array(
            z.object({
              id: z.string(),
              displayName: z.string(),
              isRunning: z.boolean(),
              path: z.string().optional()
            })
          )
        })
        .safeParse(result)
      if (!parsed.success) throw new Error('ENGINE_UNAVAILABLE: invalid application inventory')
      return parsed.data.apps.map(({ id, path, ...app }) => ({
        ...app,
        bundleIdentifier: id,
        ...(path === undefined ? {} : { appPath: path })
      }))
    },
    async getAppState(input: Input, context: CodexCallContext) {
      const result = await request(
        {
          operation: 'app-state',
          app: input.app,
          sessionId: context.sessionId,
          maxElements: 300,
          maxDepth: 12,
          disableDiff: input.disableDiff,
          screenshot: true
        },
        context
      )
      const parsed = stateSchema.safeParse(result)
      if (!parsed.success) throw new Error('ENGINE_UNAVAILABLE: invalid application state')
      const state = parsed.data
      let screenshot: { url: string } | undefined
      if (state.screenshot) {
        const bytes = Buffer.from(state.screenshot.base64, 'base64')
        if (!bytes.length) throw new Error('ENGINE_UNAVAILABLE: empty screenshot')
        screenshot = {
          url: await options.writeScreenshot(context.sessionId, bytes, state.screenshot.mimeType)
        }
      }
      return {
        app: { bundleIdentifier: state.app },
        ...(state.appSpecificInstructions === undefined
          ? {}
          : { appSpecificInstructions: state.appSpecificInstructions }),
        skyshot: { text: state.text, ...(screenshot ? { screenshot } : {}) }
      }
    },
    async click(input: Input, context: CodexCallContext) {
      if (input.elementIndex !== undefined && (input.x !== undefined || input.y !== undefined)) {
        throw new Error('INVALID_REQUEST: click requires either an element or a point')
      }
      await act(
        input,
        {
          ...(input.elementIndex === undefined
            ? { type: 'click', x: input.x, y: input.y }
            : { type: 'click-element', elementIndex: input.elementIndex }),
          mouseButton:
            input.mouseButton === 'l'
              ? 'left'
              : input.mouseButton === 'r'
                ? 'right'
                : input.mouseButton === 'm'
                  ? 'middle'
                  : input.mouseButton,
          clickCount: input.clickCount
        },
        context
      )
    },
    async drag(input: Input, context: CodexCallContext) {
      await act(
        input,
        { type: 'drag', fromX: input.fromX, fromY: input.fromY, toX: input.toX, toY: input.toY },
        context
      )
    },
    async paste(input: Input, context: CodexCallContext) {
      await act(input, { type: 'paste', text: input.text, format: input.format }, context)
    },
    async performSecondaryAction(input: Input, context: CodexCallContext) {
      await act(
        input,
        { type: 'secondary-action', elementIndex: input.elementIndex, action: input.action },
        context
      )
    },
    async pressKey(input: Input, context: CodexCallContext) {
      // The helper parses the complete xdotool expression; the adapter must not truncate its keys.
      await act(input, { type: 'key', key: input.key, modifiers: [] }, context)
    },
    async scroll(input: Input, context: CodexCallContext) {
      const pages = input.pages ?? 1
      if (typeof pages !== 'number' || !Number.isFinite(pages) || pages <= 0)
        throw new Error('INVALID_REQUEST: pages must be positive')
      const distance = Math.round(pages * 600)
      const deltas: Record<string, [number, number]> = {
        up: [0, distance],
        down: [0, -distance],
        left: [distance, 0],
        right: [-distance, 0],
        u: [0, distance],
        d: [0, -distance],
        l: [distance, 0],
        r: [-distance, 0]
      }
      const delta = typeof input.direction === 'string' ? deltas[input.direction] : undefined
      if (
        !delta ||
        (input.elementIndex !== undefined && (input.x !== undefined || input.y !== undefined))
      ) {
        throw new Error('INVALID_REQUEST: invalid scroll target or direction')
      }
      await act(
        input,
        {
          type: 'scroll',
          ...(input.elementIndex === undefined
            ? { x: input.x, y: input.y }
            : { elementIndex: input.elementIndex }),
          deltaX: delta[0],
          deltaY: delta[1]
        },
        context
      )
    },
    async selectText(input: Input, context: CodexCallContext) {
      await act(
        input,
        {
          type: 'select-text',
          elementIndex: input.elementIndex,
          text: input.text,
          prefix: input.prefix,
          suffix: input.suffix,
          selectionType:
            typeof input.selection === 'string'
              ? input.selection.replaceAll('_', '-')
              : input.selection
        },
        context
      )
    },
    async setValue(input: Input, context: CodexCallContext) {
      await act(
        input,
        { type: 'set-value', elementIndex: input.elementIndex, value: input.value },
        context
      )
    },
    async typeText(input: Input, context: CodexCallContext) {
      await act(input, { type: 'type', text: input.text }, context)
    }
  }
}
