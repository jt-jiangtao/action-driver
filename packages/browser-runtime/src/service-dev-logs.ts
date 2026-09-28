interface DevEvent {
  source: { tabId?: number }
  method: string
  params: unknown
}
interface Cdp {
  addTabAttachHandler(
    handler: (id: number, options: Record<string, unknown>) => Promise<void> | undefined
  ): unknown
  on(event: 'tabDetached', handler: (id: number) => void): unknown
  on(event: 'event', handler: (event: DevEvent) => void): unknown
  call(
    id: number,
    method: string,
    params: undefined,
    options: Record<string, unknown>
  ): Promise<unknown>
  hasBrowserAuthRawEventProtection(id: number): boolean
}
export interface DevLog {
  level: string
  message: string
  timestamp: string
  url?: string
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const string = (value: Record<string, unknown>, key: string) =>
  typeof value[key] === 'string' ? value[key] : undefined
const urlHint = (url: string | undefined) => (url ? { url } : {})
function consoleLog(params: unknown): DevLog | null {
  if (!record(params)) return null
  const type = string(params, 'type'),
    level =
      type === 'debug'
        ? 'debug'
        : type === 'info'
          ? 'info'
          : type === 'warn' || type === 'warning'
            ? 'warn'
            : type === 'error'
              ? 'error'
              : 'log',
    message =
      !Array.isArray(params.args) || params.args.length === 0
        ? ''
        : params.args
            .map((value) =>
              record(value)
                ? value.type === 'string'
                  ? String(value.value ?? '')
                  : value.value !== undefined
                    ? String(value.value)
                    : typeof value.description === 'string'
                      ? value.description
                      : '[object]'
                : '[object]'
            )
            .join(' '),
    stack = params.stackTrace,
    frame = record(stack) && Array.isArray(stack.callFrames) ? stack.callFrames[0] : undefined
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(record(frame) ? urlHint(string(frame, 'url')) : {})
  }
}
function exceptionLog(params: unknown): DevLog | null {
  if (!record(params) || !record(params.exceptionDetails)) return null
  const details = params.exceptionDetails,
    exception = record(details.exception) ? details.exception : null,
    message =
      typeof exception?.value === 'string'
        ? exception.value
        : (string(exception ?? {}, 'description') ??
          string(details, 'text') ??
          'Uncaught exception')
  return {
    level: 'error',
    message,
    timestamp: new Date().toISOString(),
    ...urlHint(string(details, 'url'))
  }
}
export class DevLogs {
  logsByTabId = new Map<number, DevLog[]>()
  runtimeEnabledTabIds = new Set<number>()
  runtimeEnablePromises = new Map<number, Promise<void>>()
  constructor(private cdp: Cdp) {
    cdp.addTabAttachHandler((id, options) => {
      if (!this.runtimeEnablePromises.has(id)) return this.ensureRuntimeEnabled(id, options)
    })
    cdp.on('tabDetached', (id) => {
      this.logsByTabId.delete(id)
      this.runtimeEnabledTabIds.delete(id)
      this.runtimeEnablePromises.delete(id)
    })
    cdp.on('event', (event) => this.handleCdpEvent(event))
  }
  async logs({
    tabId,
    filter,
    levels,
    limit = 100
  }: {
    tabId: number
    filter?: string
    levels?: string[]
    limit?: number
  }) {
    await this.ensureRuntimeEnabled(tabId)
    const selected = levels ? new Set(levels) : null
    return (this.logsByTabId.get(tabId) ?? [])
      .filter(
        (log) =>
          !((filter && !log.message.includes(filter)) || (selected && !selected.has(log.level)))
      )
      .slice(-limit)
  }
  async ensureRuntimeEnabled(id: number, options: Record<string, unknown> = {}) {
    if (this.runtimeEnabledTabIds.has(id)) return
    const pending = this.runtimeEnablePromises.get(id)
    if (pending) {
      await pending
      return
    }
    const request = (async () => {
      await this.cdp.call(id, 'Runtime.enable', undefined, options)
      this.runtimeEnabledTabIds.add(id)
    })()
    this.runtimeEnablePromises.set(id, request)
    try {
      await request
    } finally {
      this.runtimeEnablePromises.delete(id)
    }
  }
  handleCdpEvent(event: DevEvent) {
    const id = event.source.tabId
    if (typeof id !== 'number' || this.cdp.hasBrowserAuthRawEventProtection(id)) return
    const log =
      event.method === 'Runtime.consoleAPICalled'
        ? consoleLog(event.params)
        : event.method === 'Runtime.exceptionThrown'
          ? exceptionLog(event.params)
          : null
    if (log !== null) this.pushLog(id, log)
  }
  pushLog(id: number, log: DevLog) {
    const logs = this.logsByTabId.get(id) ?? []
    logs.push(log)
    if (logs.length > 500) logs.splice(0, logs.length - 500)
    this.logsByTabId.set(id, logs)
  }
}
