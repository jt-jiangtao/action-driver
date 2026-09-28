import type { CDPSession } from 'playwright-core'

export interface LocalCdpEvent {
  sequence: number
  source: { tabId: number }
  method: string
  params: Record<string, unknown>
}

export interface LocalCdpEventOptions {
  afterSequence?: number | undefined
  limit?: number | undefined
  methods?: string[] | undefined
  timeoutMs?: number | undefined
}

/** Per-tab CDP channel. Subscriptions are explicit so no process-wide debugger is left active. */
export class LocalCdpAdapter {
  private readonly subscribed = new Set<string>()
  private listener: ((event: { method: string; params?: object }) => void) | undefined
  private readonly waiters = new Set<{
    resolve: () => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private readonly events: LocalCdpEvent[] = []
  private sequence = 0
  private closed = false
  private closing: Promise<void> | undefined

  constructor(private readonly session: CDPSession, private readonly tabId: number) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.assertOpen()
    return (this.session.send as unknown as
      (method: string, params: Record<string, unknown>) => Promise<unknown>)(method, params)
  }

  private assertOpen() {
    if (this.closed) throw new Error('BROWSER_CDP_CLOSED')
  }

  private watch(method: string) {
    this.subscribed.add(method)
    if (this.listener) return
    this.listener = ({ method, params }) => {
      if (this.closed) return
      if (!this.subscribed.has(method)) return
      this.events.push({ sequence: ++this.sequence, source: { tabId: this.tabId },
        method, params: params != null && typeof params === 'object'
          ? params as Record<string, unknown> : {} })
      if (this.events.length > 1000) this.events.shift()
      for (const waiter of this.waiters) waiter.resolve()
    }
    this.session.on('event', this.listener)
  }

  async readEvents(options: LocalCdpEventOptions = {}) {
    this.assertOpen()
    for (const method of options.methods ?? []) this.watch(method)
    const after = options.afterSequence ?? 0
    const limit = options.limit ?? 1000
    const collect = () => {
      const matching = this.events.filter((event) => event.sequence > after &&
        (options.methods == null || options.methods.includes(event.method)))
      return { cursor: this.sequence, events: matching.slice(0, limit),
        hasMore: matching.length > limit,
        truncated: this.events.length > 0 && after < this.events[0]!.sequence - 1 }
    }
    if (collect().events.length > 0 || !options.timeoutMs || options.timeoutMs <= 0) return collect()
    await new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve: () => { cleanup(); resolve() },
        reject: (error: Error) => { cleanup(); reject(error) },
        timer: undefined as unknown as ReturnType<typeof setTimeout>
      }
      const cleanup = () => { clearTimeout(waiter.timer); this.waiters.delete(waiter) }
      waiter.timer = setTimeout(waiter.resolve, options.timeoutMs)
      this.waiters.add(waiter)
      if (this.closed) waiter.reject(new Error('BROWSER_CDP_CLOSED'))
    })
    this.assertOpen()
    return collect()
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true
      for (const waiter of this.waiters) waiter.reject(new Error('BROWSER_CDP_CLOSED'))
      if (this.listener) this.session.off('event', this.listener)
      this.listener = undefined
      this.subscribed.clear()
      this.events.length = 0
      this.closing = this.session.detach()
    }
    return this.closing
  }
}
