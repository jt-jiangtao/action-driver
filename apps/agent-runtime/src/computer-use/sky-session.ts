/**
 * The `sky` object the JavaScript entry exposes, mapped onto the native helper protocol.
 *
 * The helper speaks in observations and element references; the Skill documents an index-addressed
 * API (`element_index`) whose state calls never leak a reference. This module is the adapter: it
 * renders the accessibility tree as indexed text, remembers the observation behind the latest state
 * of each app, resolves `element_index` against that state, and refreshes once when the interface
 * moved between reading and acting.
 */

export type SkyInvoker = (input: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>

/** Writes one screenshot next to the session and returns the `file://` URL the model should read. */
export type SkyScreenshotWriter = (bytes: Buffer, mimeType: string) => Promise<string>

export type SkySession = {
  invoke(method: string, args: unknown, signal?: AbortSignal): Promise<unknown>
  dispose(): void
}

type JsonRecord = { [key: string]: unknown }

type Observation = {
  observationId: string
  app: string
  refs: string[]
  text: string
}

const SKY_METHODS = new Set([
  'list_apps', 'get_app_state', 'click', 'drag', 'paste', 'press_key', 'scroll',
  'select_text', 'set_value', 'type_text', 'perform_secondary_action'
])

/** Pixel distance one `pages` step scrolls: about one screen of content. */
const PIXELS_PER_PAGE = 600

const KEY_MODIFIERS: Record<string, string> = {
  super: 'command', cmd: 'command', command: 'command', meta: 'command',
  ctrl: 'control', control: 'control',
  alt: 'option', option: 'option',
  shift: 'shift'
}

const KEY_NAMES: Record<string, string> = {
  return: 'return', enter: 'return',
  tab: 'tab',
  space: 'space', spacebar: 'space',
  escape: 'escape', esc: 'escape',
  backspace: 'delete', delete: 'delete',
  up: 'up', down: 'down', left: 'left', right: 'right',
  a: 'a', c: 'c', v: 'v', x: 'x', z: 'z', s: 's'
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function requiredString(args: JsonRecord, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`)
  }
  return value
}

function optionalNumber(value: unknown, key: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a number`)
  return value
}

/** Renders the tree as indexed lines, in the same order the refs are collected. */
function renderTree(node: unknown): { lines: string[]; refs: string[] } {
  const lines: string[] = []
  const refs: string[] = []
  const walk = (current: unknown, depth: number): void => {
    if (!isRecord(current)) return
    const reference = typeof current.ref === 'string' ? current.ref : ''
    const index = refs.length
    refs.push(reference)
    const role = typeof current.role === 'string' ? current.role : 'element'
    const title = typeof current.title === 'string' ? current.title
      : typeof current.description === 'string' ? current.description : ''
    const actions = Array.isArray(current.actions)
      ? current.actions.filter((action): action is string => typeof action === 'string')
      : []
    lines.push(`${'  '.repeat(depth)}[${index}] ${role} "${title}"` +
      (actions.length ? ` actions=[${actions.join(',')}]` : ''))
    const children = Array.isArray(current.children) ? current.children : []
    for (const child of children) walk(child, depth + 1)
  }
  walk(node, 0)
  return { lines, refs }
}

function parseKey(key: string): { key: string; modifiers: string[] } {
  const parts = key.toLowerCase().split('+').map((part) => part.trim()).filter(Boolean)
  const name = parts.pop() ?? ''
  const modifiers = parts.map((part) => {
    const modifier = KEY_MODIFIERS[part]
    if (!modifier) throw new Error(`js: unsupported key modifier "${part}"`)
    return modifier
  })
  const resolved = KEY_NAMES[name]
  if (!resolved) {
    throw new Error(`js: key "${name}" is not supported by the native helper; supported keys are ` +
      'return, tab, space, escape, delete, up, down, left, right, a, c, v, x, z, s')
  }
  return { key: resolved, modifiers: Array.from(new Set(modifiers)) }
}

export function createSkySession(options: {
  invoke: SkyInvoker
  writeScreenshot: SkyScreenshotWriter
}): SkySession {
  const observations = new Map<string, Observation>()
  /** Every spelling the model used or we learned (display name, file name, bundle id) -> bundle id. */
  const aliases = new Map<string, string>()
  let appIndex: { at: number; entries: JsonRecord[] } | null = null
  let closed = false

  const request = async (input: JsonRecord, signal?: AbortSignal): Promise<JsonRecord> => {
    if (closed) throw new Error('ENGINE_UNAVAILABLE: the js session is closed')
    const result = await options.invoke(input, signal)
    return isRecord(result) ? result : {}
  }

  /**
   * The helper resolves a bundle id, a path or the English `.app` name, so a localized display name
   * (`文本编辑`) comes back as "Unknown application". `list_apps` knows both spellings, which is the
   * retry the Skill documents — done here so the model does not have to.
   */
  const listApps = async (signal?: AbortSignal): Promise<JsonRecord[]> => {
    if (appIndex && Date.now() - appIndex.at < 30_000) return appIndex.entries
    const result = await request({ operation: 'list-apps' }, signal)
    const entries = (Array.isArray(result.apps) ? result.apps : [])
      .filter((entry): entry is JsonRecord => isRecord(entry) && typeof entry.id === 'string')
    appIndex = { at: Date.now(), entries }
    for (const entry of entries) {
      if (typeof entry.displayName === 'string') aliases.set(entry.displayName, String(entry.id))
    }
    return entries
  }

  const resolveApp = async (app: string, signal?: AbortSignal): Promise<string> => {
    const known = aliases.get(app)
    if (known) return known
    for (const entry of await listApps(signal)) {
      if (entry.id === app || entry.displayName === app) return String(entry.id)
    }
    return app
  }

  const isUnknownApp = (error: unknown): boolean =>
    /Unknown application/.test(error instanceof Error ? error.message : String(error))

  const remember = (requested: string, observation: Observation): void => {
    observations.set(requested, observation)
    observations.set(observation.app, observation)
    aliases.set(requested, observation.app)
    aliases.set(observation.app, observation.app)
  }

  const readStateOnce = async (app: string, signal?: AbortSignal):
    Promise<{ observation: Observation; result: JsonRecord }> => {
    const result = await request({
      operation: 'app-state',
      app,
      maxElements: 300,
      maxDepth: 12,
      // The entry always returns the full tree: index-addressed actions must never be derived from
      // a partial list, because a stale index resolves to a different element instead of failing.
      disableDiff: true,
      capture: { maxWidth: 1600, maxHeight: 1600 }
    }, signal)
    const tree = renderTree(result.tree)
    const observation: Observation = {
      observationId: typeof result.observationId === 'string' ? result.observationId : '',
      app: typeof result.app === 'string' ? result.app : app,
      refs: tree.refs,
      text: tree.lines.join('\n')
    }
    if (!observation.observationId) throw new Error('ENGINE_UNAVAILABLE: app state came back without an observation')
    remember(app, observation)
    return { observation, result }
  }

  const readState = async (app: string, signal?: AbortSignal):
    Promise<{ observation: Observation; result: JsonRecord }> => {
    try {
      return await readStateOnce(app, signal)
    } catch (error) {
      if (!isUnknownApp(error)) throw error
      const resolved = await resolveApp(app, signal)
      if (resolved === app) throw error
      const result = await readStateOnce(resolved, signal)
      // Keep the spelling the model used working for the actions that follow.
      remember(app, result.observation)
      return result
    }
  }

  const observationFor = async (app: string, signal?: AbortSignal): Promise<Observation> =>
    observations.get(app) ?? (await readState(app, signal)).observation

  const screenshotOf = async (result: JsonRecord): Promise<{ url: string } | null> => {
    const screenshot = result.screenshot
    if (!isRecord(screenshot) || typeof screenshot.base64 !== 'string') return null
    const bytes = Buffer.from(screenshot.base64, 'base64')
    if (bytes.length === 0) return null
    const mimeType = typeof screenshot.mimeType === 'string' ? screenshot.mimeType : 'image/jpeg'
    return { url: await options.writeScreenshot(bytes, mimeType) }
  }

  /** Runs one action, re-reading the interface once when it moved under us. */
  const act = async (
    app: string,
    build: (observation: Observation) => JsonRecord,
    signal?: AbortSignal
  ): Promise<void> => {
    for (let attempt = 0; ; attempt += 1) {
      const observation = attempt === 0
        ? await observationFor(app, signal)
        : (await readState(app, signal)).observation
      try {
        await request({
          operation: 'act',
          observationId: observation.observationId,
          action: build(observation)
        }, signal)
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (attempt === 0 && (message.startsWith('STALE_REFERENCE') ||
            message.startsWith('ENGINE_UNAVAILABLE'))) continue
        throw error
      }
    }
  }

  const elementRef = (observation: Observation, index: unknown): string => {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
      throw new Error('element_index must be a non-negative integer')
    }
    const reference = observation.refs[index]
    if (!reference) {
      throw new Error(`element_index ${index} is outside the latest state ` +
        `(0-${observation.refs.length - 1}); call sky.get_app_state again`)
    }
    return reference
  }

  const scrollDelta = (args: JsonRecord): { deltaX: number; deltaY: number } => {
    const direction = requiredString(args, 'direction').toLowerCase()
    const pages = optionalNumber(args.pages, 'pages') ?? 1
    const distance = Math.round(pages * PIXELS_PER_PAGE)
    switch (direction) {
      case 'up': case 'u': return { deltaX: 0, deltaY: distance }
      case 'down': case 'd': return { deltaX: 0, deltaY: -distance }
      case 'left': case 'l': return { deltaX: distance, deltaY: 0 }
      case 'right': case 'r': return { deltaX: -distance, deltaY: 0 }
      default: throw new Error(`sky.scroll does not understand direction "${direction}"`)
    }
  }

  const methods: Record<string, (args: JsonRecord, signal?: AbortSignal) => Promise<unknown>> = {
    async list_apps(_args, signal) {
      return await listApps(signal)
    },

    async get_app_state(args, signal) {
      const app = requiredString(args, 'app')
      const { observation, result } = await readState(app, signal)
      return { app: observation.app, text: observation.text,
        screenshot: await screenshotOf(result) }
    },

    async click(args, signal) {
      const app = requiredString(args, 'app')
      const button = args.mouse_button
      if (button !== undefined && button !== 'left' && button !== 'l') {
        throw new Error('sky.click supports only the left button; use perform_secondary_action')
      }
      const count = optionalNumber(args.click_count, 'click_count')
      if (count !== undefined && count !== 1) {
        throw new Error('sky.click supports click_count 1 only')
      }
      await act(app, (observation) => args.element_index !== undefined
        ? { type: 'click-element', elementRef: elementRef(observation, args.element_index) }
        : { type: 'click',
            x: optionalNumber(args.x, 'x') ?? throwMissing('x'),
            y: optionalNumber(args.y, 'y') ?? throwMissing('y') }, signal)
      return null
    },

    async drag(args, signal) {
      const app = requiredString(args, 'app')
      await act(app, () => ({
        type: 'drag',
        fromX: optionalNumber(args.from_x, 'from_x') ?? throwMissing('from_x'),
        fromY: optionalNumber(args.from_y, 'from_y') ?? throwMissing('from_y'),
        toX: optionalNumber(args.to_x, 'to_x') ?? throwMissing('to_x'),
        toY: optionalNumber(args.to_y, 'to_y') ?? throwMissing('to_y')
      }), signal)
      return null
    },

    async paste(args, signal) {
      const app = requiredString(args, 'app')
      const text = requiredString(args, 'text')
      const format = args.format === undefined ? 'text' : requiredString(args, 'format')
      if (format !== 'text' && format !== 'md' && format !== 'html') {
        throw new Error('sky.paste format must be text, md or html')
      }
      await act(app, () => ({ type: 'paste', text, format }), signal)
      return null
    },

    async press_key(args, signal) {
      const app = requiredString(args, 'app')
      const { key, modifiers } = parseKey(requiredString(args, 'key'))
      await act(app, () => ({ type: 'key', key, modifiers }), signal)
      return null
    },

    async scroll(args, signal) {
      const app = requiredString(args, 'app')
      const delta = scrollDelta(args)
      // The helper posts a wheel event where the pointer is; it has no per-element scroll target.
      await act(app, () => ({ type: 'scroll', deltaX: delta.deltaX, deltaY: delta.deltaY }), signal)
      return null
    },

    async select_text(args, signal) {
      const app = requiredString(args, 'app')
      const text = requiredString(args, 'text')
      const selectionType = args.selection_type
      if (selectionType !== undefined && selectionType !== 'text' &&
          selectionType !== 'cursor_before' && selectionType !== 'cursor_after') {
        throw new Error('selection_type must be text, cursor_before or cursor_after')
      }
      await act(app, (observation) => ({
        type: 'select-text',
        elementRef: elementRef(observation, args.element_index),
        text,
        ...(typeof args.prefix === 'string' ? { prefix: args.prefix } : {}),
        ...(typeof args.suffix === 'string' ? { suffix: args.suffix } : {}),
        ...(selectionType === undefined ? {} : {
          selectionType: String(selectionType).replace('_', '-')
        })
      }), signal)
      return null
    },

    async set_value(args, signal) {
      const app = requiredString(args, 'app')
      const value = args.value
      if (typeof value !== 'string') throw new Error('value must be a string')
      await act(app, (observation) => ({
        type: 'set-value',
        elementRef: elementRef(observation, args.element_index),
        value
      }), signal)
      return null
    },

    async type_text(args, signal) {
      const app = requiredString(args, 'app')
      const text = requiredString(args, 'text')
      await act(app, () => ({ type: 'type', text }), signal)
      return null
    },

    async perform_secondary_action(args, signal) {
      const app = requiredString(args, 'app')
      const action = requiredString(args, 'action')
      await act(app, (observation) => ({
        type: 'secondary-action',
        elementRef: elementRef(observation, args.element_index),
        action
      }), signal)
      return null
    }
  }

  return {
    async invoke(method, args, signal) {
      if (!SKY_METHODS.has(method)) throw new Error(`sky.${method} does not exist`)
      if (args !== undefined && !isRecord(args)) throw new Error(`sky.${method} expects an object`)
      return await methods[method]!(args ?? {}, signal)
    },
    dispose() { closed = true; observations.clear() }
  }
}

function throwMissing(key: string): never {
  throw new Error(`sky.click needs either element_index or explicit ${key}`)
}
