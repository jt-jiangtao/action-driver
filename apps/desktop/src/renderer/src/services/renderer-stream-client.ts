import type { AgentGoalRequest } from '@actiondriver/contracts'
import {
  STREAM_PROTOCOL,
  StreamLifecycleGuard,
  parseStreamServerEvent,
  type RequestCreateEvent,
  type StreamClientEvent,
  type StreamResponseEvent,
  type StreamServerEvent
} from '@actiondriver/runtime-contracts'
import type { RuntimeConnectionInfo } from '../../../shared/runtime-connection-contract'

export type RuntimeStreamAccepted = Extract<StreamServerEvent, { type: 'request.accepted' }>
export type RuntimeStreamListener = (event: StreamServerEvent) => void

type SocketEvent = { data?: unknown; code?: number; reason?: string }
export interface RendererWebSocket {
  readonly readyState: number
  addEventListener(type: string, listener: (event: SocketEvent) => void): void
  send(value: string): void
  close(code?: number, reason?: string): void
}

export class RendererStreamClient {
  private socket: RendererWebSocket | null = null
  private connection: RuntimeConnectionInfo | null = null
  private connectPromise: Promise<void> | null = null
  private resolveConnect: (() => void) | null = null
  private rejectConnect: ((error: Error) => void) | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private intentionallyClosed = false
  private readonly listeners = new Set<RuntimeStreamListener>()
  private readonly pendingCreates = new Map<
    string,
    {
      event: RequestCreateEvent
      resolve(value: RuntimeStreamAccepted): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private readonly acceptedByTask = new Map<string, RuntimeStreamAccepted>()
  private readonly cursors = new Map<string, number>()
  private readonly sequences = new Map<string, number>()
  private readonly activeRequests = new Set<string>()
  private readonly lifecycleGuards = new Map<string, StreamLifecycleGuard>()
  private readonly pendingBySequence = new Map<string, Map<number, StreamServerEvent>>()
  private readonly requestedGaps = new Set<string>()
  private readonly seenEventIds = new Set<string>()
  private readonly seenOrder: string[] = []

  constructor(
    private readonly options: {
      getConnection(): Promise<RuntimeConnectionInfo>
      createWebSocket?: (url: string, protocols: string[]) => unknown
      id?: () => string
      retryDelay?: (attempt: number) => number
      maxSeenEvents?: number
      commandTimeoutMs?: number
    }
  ) {}

  async create(
    input: AgentGoalRequest & { systemPrompt?: string }
  ): Promise<RuntimeStreamAccepted> {
    await this.requireReady()
    const requestId = this.nextId()
    const common = {
      type: 'request.create' as const,
      protocol: STREAM_PROTOCOL,
      eventId: this.nextId(),
      createdAt: new Date().toISOString(),
      requestId,
      idempotencyKey: this.nextId()
    }
    const event: RequestCreateEvent =
      'sessionId' in input
        ? {
            ...common,
            sessionId: input.sessionId,
            payload: {
              input: { role: 'user', content: input.goal },
              ...(input.systemPrompt === undefined ? {} : { systemPrompt: input.systemPrompt }),
              skills: []
            }
          }
        : {
            ...common,
            sessionId: null,
            payload: {
              input: { role: 'user', content: input.goal },
              model: input.model,
              ...(input.systemPrompt === undefined ? {} : { systemPrompt: input.systemPrompt }),
              skills: []
            }
          }
    const accepted = new Promise<RuntimeStreamAccepted>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCreates.delete(requestId)
        reject(new Error('Runtime stream request timed out'))
      }, this.options.commandTimeoutMs ?? 15_000)
      this.pendingCreates.set(requestId, { event, resolve, reject, timer })
    })
    this.send(event)
    return await accepted
  }

  async cancel(taskId: string): Promise<void> {
    await this.requireReady()
    const accepted = this.acceptedByTask.get(taskId)
    if (!accepted) throw new Error(`Unknown active task: ${taskId}`)
    this.send({
      type: 'request.cancel',
      protocol: STREAM_PROTOCOL,
      eventId: this.nextId(),
      createdAt: new Date().toISOString(),
      requestId: accepted.requestId,
      taskId: accepted.taskId,
      responseId: accepted.responseId
    })
  }

  subscribe(listener: RuntimeStreamListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async close(): Promise<void> {
    this.intentionallyClosed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const socket = this.socket
    this.socket = null
    this.connectPromise = null
    this.resolveConnect = null
    this.rejectConnect = null
    for (const pending of this.pendingCreates.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Runtime stream client closed'))
    }
    this.pendingCreates.clear()
    if (!socket || socket.readyState === 3) return
    await new Promise<void>((resolve) => {
      socket.addEventListener('close', () => resolve())
      socket.close(1000, 'Client shutting down')
    })
  }

  private async requireReady(): Promise<void> {
    if (!this.connection) this.connection = await this.options.getConnection()
    if (this.socket?.readyState === 1 && this.connectPromise) {
      await this.connectPromise
      return
    }
    if (!this.connectPromise) {
      this.intentionallyClosed = false
      this.connectPromise = new Promise<void>((resolve, reject) => {
        this.resolveConnect = resolve
        this.rejectConnect = reject
      })
      this.open()
    }
    await this.connectPromise
  }

  private open(): void {
    const connection = this.connection
    if (!connection || this.intentionallyClosed) return
    const socket = (
      this.options.createWebSocket
        ? this.options.createWebSocket(connection.wsUrl, [connection.protocol])
        : new globalThis.WebSocket(connection.wsUrl, [connection.protocol])
    ) as RendererWebSocket
    this.socket = socket
    socket.addEventListener('open', () => {
      this.send({
        type: 'auth',
        protocol: STREAM_PROTOCOL,
        eventId: this.nextId(),
        createdAt: new Date().toISOString(),
        payload: { token: connection.accessToken }
      })
    })
    socket.addEventListener('message', (event) => this.receive(String(event.data ?? '')))
    socket.addEventListener('error', () => undefined)
    socket.addEventListener('close', (event) => this.handleClose(socket, event.code ?? 1006))
  }

  private receive(raw: string): void {
    let event: StreamServerEvent
    try {
      event = parseStreamServerEvent(JSON.parse(raw) as unknown)
    } catch {
      this.socket?.close(1002, 'Invalid server event')
      return
    }
    if (event.type === 'session.ready') {
      this.reconnectAttempt = 0
      this.resolveConnect?.()
      this.resolveConnect = null
      this.rejectConnect = null
      this.connectPromise = Promise.resolve()
      for (const pending of this.pendingCreates.values()) this.send(pending.event)
      for (const requestId of this.activeRequests) this.resume(requestId)
      return
    }
    if ('cursor' in event) {
      this.queueBySequence(event)
      return
    }
    this.deliver(event)
  }

  private queueBySequence(
    event: Extract<StreamServerEvent, { cursor: number; requestId: string }>
  ): void {
    const current = this.cursors.get(event.requestId)
    if (event.type === 'response.snapshot') {
      if (current !== undefined && event.cursor <= current) return
      this.deliver(event)
      const pending = this.pendingBySequence.get(event.requestId)
      if (pending) {
        for (const sequence of pending.keys()) {
          if (sequence <= event.sequence) pending.delete(sequence)
        }
      }
      this.requestedGaps.delete(event.requestId)
      this.drainSequence(event.requestId)
      return
    }
    if (current === undefined && event.type === 'request.accepted') {
      this.deliver(event)
      this.drainSequence(event.requestId)
      return
    }
    const lastSequence = this.sequences.get(event.requestId) ?? -1
    if (event.sequence <= lastSequence) return
    const pending =
      this.pendingBySequence.get(event.requestId) ?? new Map<number, StreamServerEvent>()
    pending.set(event.sequence, event)
    this.pendingBySequence.set(event.requestId, pending)
    if (pending.size > 512) {
      pending.clear()
      this.resume(event.requestId)
      return
    }
    this.drainSequence(event.requestId)
  }

  private drainSequence(requestId: string): void {
    const pending = this.pendingBySequence.get(requestId)
    if (!pending) return
    let next = (this.sequences.get(requestId) ?? -1) + 1
    while (pending.has(next)) {
      const event = pending.get(next)!
      pending.delete(next)
      this.deliver(event)
      next = (this.sequences.get(requestId) ?? next) + 1
    }
    if (pending.size === 0) {
      this.pendingBySequence.delete(requestId)
      this.requestedGaps.delete(requestId)
    } else if (!this.requestedGaps.has(requestId)) {
      this.requestedGaps.add(requestId)
      this.resume(requestId)
    }
  }

  private deliver(event: StreamServerEvent): void {
    if (this.seenEventIds.has(event.eventId)) return
    if (
      event.type === 'response.start' ||
      event.type === 'response.content' ||
      event.type === 'response.end'
    ) {
      const guard = this.lifecycleGuards.get(event.responseId) ?? new StreamLifecycleGuard()
      this.lifecycleGuards.set(event.responseId, guard)
      try {
        guard.apply(event as StreamResponseEvent)
      } catch {
        this.resume(event.requestId)
        return
      }
    }
    if (event.type === 'response.snapshot') this.lifecycleGuards.delete(event.responseId)

    for (const listener of this.listeners) listener(event)
    this.remember(event.eventId)
    if ('cursor' in event) this.cursors.set(event.requestId, event.cursor)
    if ('sequence' in event) this.sequences.set(event.requestId, event.sequence)
    if (event.type === 'request.accepted') {
      this.activeRequests.add(event.requestId)
      this.acceptedByTask.set(event.taskId, event)
      const pending = this.pendingCreates.get(event.requestId)
      if (pending) {
        clearTimeout(pending.timer)
        pending.resolve(event)
        this.pendingCreates.delete(event.requestId)
      }
    }
    if (event.type === 'request.error') {
      const pending = this.pendingCreates.get(event.requestId)
      if (pending) {
        clearTimeout(pending.timer)
        pending.reject(new Error(event.error.message))
        this.pendingCreates.delete(event.requestId)
      }
    }
    if (event.type === 'runtime.interrupted') this.lifecycleGuards.delete(event.responseId)
    if (event.type === 'response.end' || event.type === 'runtime.interrupted')
      this.activeRequests.delete(event.requestId)
  }

  private handleClose(socket: RendererWebSocket, code: number): void {
    if (this.socket !== socket) return
    this.socket = null
    if (this.intentionallyClosed) return
    if (code === 1008) {
      const error = new Error('Runtime stream authentication failed')
      this.rejectConnect?.(error)
      this.connectPromise = null
      this.resolveConnect = null
      this.rejectConnect = null
      for (const pending of this.pendingCreates.values()) {
        clearTimeout(pending.timer)
        pending.reject(error)
      }
      this.pendingCreates.clear()
      return
    }
    this.connectPromise = null
    const delay =
      this.options.retryDelay?.(this.reconnectAttempt) ?? defaultRetryDelay(this.reconnectAttempt)
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.intentionallyClosed) return
      this.connectPromise = new Promise<void>((resolve, reject) => {
        this.resolveConnect = resolve
        this.rejectConnect = reject
      })
      this.open()
    }, delay)
  }

  private resume(requestId: string): void {
    if (this.socket?.readyState !== 1) return
    this.send({
      type: 'request.resume',
      protocol: STREAM_PROTOCOL,
      eventId: this.nextId(),
      createdAt: new Date().toISOString(),
      requestId,
      afterCursor: this.cursors.get(requestId) ?? 0
    })
  }

  private send(event: StreamClientEvent): void {
    if (this.socket?.readyState !== 1) throw new Error('Runtime stream is not connected')
    this.socket.send(JSON.stringify(event))
  }

  private remember(eventId: string): void {
    this.seenEventIds.add(eventId)
    this.seenOrder.push(eventId)
    const limit = this.options.maxSeenEvents ?? 10_000
    while (this.seenOrder.length > limit) {
      const oldest = this.seenOrder.shift()
      if (oldest) this.seenEventIds.delete(oldest)
    }
  }

  private nextId(): string {
    return this.options.id?.() ?? globalThis.crypto.randomUUID()
  }
}

function defaultRetryDelay(attempt: number): number {
  const base = Math.min(5_000, 100 * 2 ** attempt)
  return Math.round(base * (0.8 + Math.random() * 0.4))
}
