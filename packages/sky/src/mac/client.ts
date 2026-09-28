import type { DiscoveredApp, AppPolicyResult, WindowAppState, AudioResult } from './types.js'
import { createNativeTransport } from './native-connection.js'
import type { RequestTransport } from './native-pipe.js'
export interface RequestOptions {
  apiVersion?: string | undefined
  codexMetadata?: unknown
  timeoutSeconds?: number | undefined
}
export interface ClientOptions extends RequestOptions {
  createTransport?: (apiVersion: string) => Promise<RequestTransport>
  getRequestMeta?: () => Record<string, unknown> | undefined
}
type AppArgs = string | { app?: string | undefined }
type Target = { elementIndex?: number | undefined; x?: number | undefined; y?: number | undefined }
function appInput(app: string | undefined): { app: string } {
  if (app == null || app.trim() === '') throw new TypeError('app is required')
  return { app }
}
function appFrom(args: AppArgs) {
  return appInput(typeof args === 'string' ? args : args.app)
}
function element(index: number | undefined): string {
  if (!Number.isInteger(index)) throw new TypeError('elementIndex must be an integer')
  return String(index)
}
function point(x: number | undefined, y: number | undefined, label: string): [number, number] {
  if (!Number.isFinite(x) || !Number.isFinite(y))
    throw new TypeError(`${label} must include finite x and y coordinates`)
  return [Number(x), Number(y)]
}
function target(args: Target) {
  return args.elementIndex == null
    ? { coordinate: { _0: point(args.x, args.y, 'coordinate') } }
    : { elementID: { _0: element(args.elementIndex) } }
}
function mouse(value: string | number): number {
  if (typeof value === 'number') {
    if ([0, 1, 2].includes(value)) return value
    throw new TypeError('mouseButton number must be 0, 1, or 2')
  }
  switch (value.trim().toLowerCase()) {
    case 'l':
    case 'left':
      return 0
    case 'r':
    case 'right':
      return 1
    case 'm':
    case 'middle':
      return 2
    default:
      throw new TypeError('mouseButton must be left, right, middle, l, r, m, 0, 1, or 2')
  }
}
function direction(value: string): string {
  switch (value.trim().toLowerCase()) {
    case 'u':
    case 'up':
      return 'up'
    case 'd':
    case 'down':
      return 'down'
    case 'l':
    case 'left':
      return 'left'
    case 'r':
    case 'right':
      return 'right'
    default:
      throw new TypeError('direction must be up, down, left, or right')
  }
}
function omitUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitUndefined)
  if (value == null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, omitUndefined(value)])
  )
}
/** Typed macOS request adapter with per-version native transport reuse. */
export class MacComputerUseClient {
  private readonly transports = new Map<string, Promise<RequestTransport>>()
  private readonly options: ClientOptions
  constructor(options: ClientOptions = {}) {
    this.options = { ...options }
  }
  listApps(options: RequestOptions = {}) {
    return this.request<DiscoveredApp[]>('ComputerUseIPCListAppsRequest', {}, options)
  }
  startAudioRecording(args: { maxDurationMilliseconds?: number | undefined }, options: RequestOptions = {}) {
    return this.request<void>('ComputerUseIPCStartAudioRecordingRequest', args, options)
  }
  stopAudioRecording(options: RequestOptions = {}) {
    return this.request<AudioResult>('ComputerUseIPCStopAudioRecordingRequest', {}, options)
  }
  getAppPolicy(args: AppArgs, options: RequestOptions = {}) {
    return this.request<AppPolicyResult>('ComputerUseIPCAppPolicyRequest', appFrom(args), options)
  }
  startApp(args: AppArgs, options: RequestOptions = {}) {
    return this.request<WindowAppState>('ComputerUseIPCAppStartRequest', appFrom(args), options)
  }
  getAppState(
    args: string | { app?: string | undefined; disableDiff?: boolean | undefined },
    options: RequestOptions = {}
  ) {
    return this.request<WindowAppState>(
      'ComputerUseIPCAppGetSkyshotRequest',
      typeof args === 'string'
        ? appInput(args)
        : { ...appInput(args.app), disableDiff: args.disableDiff },
      options
    )
  }
  click(
    args: Target & { app: string; clickCount?: number | undefined; mouseButton?: string | undefined | number },
    options: RequestOptions = {}
  ) {
    return this.action(
      args.app,
      {
        click: {
          at: target(args),
          clickCount: args.clickCount === undefined ? 1 : args.clickCount,
          mouseButton: mouse(args.mouseButton === undefined ? 'left' : args.mouseButton)
        }
      },
      options
    )
  }
  drag(
    args: { app: string; fromX: number; fromY: number; toX: number; toY: number },
    options: RequestOptions = {}
  ) {
    return this.action(
      args.app,
      {
        drag: { from: point(args.fromX, args.fromY, 'from'), to: point(args.toX, args.toY, 'to') }
      },
      options
    )
  }
  paste(args: { app: string; text: string; format: string }, options: RequestOptions = {}) {
    return this.action(args.app, { paste: { text: args.text, format: args.format } }, options)
  }
  performSecondaryAction(
    args: { app: string; elementIndex: number; action: string },
    options: RequestOptions = {}
  ) {
    return this.action(
      args.app,
      { performSecondaryAction: { action: args.action, elementID: element(args.elementIndex) } },
      options
    )
  }
  pressKey(args: { app: string; key: string }, options: RequestOptions = {}) {
    if (args.key.trim() === '') throw new TypeError('key is required')
    return this.action(args.app, { pressKey: { _0: args.key } }, options)
  }
  scroll(
    args: Target & { app: string; direction: string; pages?: number | undefined },
    options: RequestOptions = {}
  ) {
    const pages = args.pages === undefined ? 1 : args.pages
    if (!Number.isFinite(pages) || pages <= 0)
      throw new TypeError('pages must be a finite number > 0')
    return this.action(
      args.app,
      { scroll: { at: target(args), direction: direction(args.direction), pages } },
      options
    )
  }
  setValue(
    args: { app: string; elementIndex: number; value: string },
    options: RequestOptions = {}
  ) {
    return this.action(
      args.app,
      { setValue: { elementID: element(args.elementIndex), value: args.value } },
      options
    )
  }
  selectText(
    args: {
      app: string
      elementIndex: number
      text: string
      prefix?: string | undefined
      suffix?: string | undefined
      selection?: string | undefined
    },
    options: RequestOptions = {}
  ) {
    return this.action(
      args.app,
      {
        selectText: {
          elementID: element(args.elementIndex),
          text: args.text,
          prefix: args.prefix,
          suffix: args.suffix,
          selection: args.selection === undefined ? 'text' : args.selection
        }
      },
      options
    )
  }
  typeText(args: { app: string; text: string }, options: RequestOptions = {}) {
    return this.action(args.app, { type: { _0: args.text } }, options)
  }
  private action(app: string, action: unknown, options: RequestOptions) {
    return this.request<void>(
      'ComputerUseIPCAppPerformActionRequest',
      { ...appInput(app), action },
      options
    )
  }
  private async request<T>(
    requestType: string,
    request: unknown,
    options: RequestOptions
  ): Promise<T> {
    const version = options.apiVersion ?? this.options.apiVersion ?? 'CodexComputerUseIPC-5'
    const transport = await this.getTransport(version)
    const host =
      this.options.getRequestMeta?.() ??
      (globalThis as typeof globalThis & { nodeRepl?: { requestMeta?: Record<string, unknown> } })
        .nodeRepl?.requestMeta
    const codexMetadata =
      options.codexMetadata !== undefined
        ? options.codexMetadata
        : this.options.codexMetadata !== undefined
          ? this.options.codexMetadata
          : host?.['x-codex-turn-metadata']
    try {
      return (await transport.request({
        requestType,
        request: omitUndefined(request),
        timeoutSeconds: options.timeoutSeconds ?? this.options.timeoutSeconds ?? 120,
        codexMetadata
      })) as T
    } catch (error) {
      if (transport.isClosed) this.transports.delete(version)
      throw error
    }
  }
  private async getTransport(version: string): Promise<RequestTransport> {
    for (;;) {
      let pending = this.transports.get(version)
      if (!pending) {
        pending = (this.options.createTransport ?? createNativeTransport)(version)
        this.transports.set(version, pending)
      }
      try {
        const transport = await pending
        if (!transport.isClosed) return transport
        if (this.transports.get(version) === pending) this.transports.delete(version)
      } catch (error) {
        if (this.transports.get(version) === pending) this.transports.delete(version)
        throw error
      }
    }
  }
}
