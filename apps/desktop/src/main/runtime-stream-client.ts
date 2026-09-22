import { WebSocket as NodeWebSocket } from 'ws'
import {
  STREAM_PROTOCOL,
  StreamLifecycleGuard,
  parseStreamServerEvent,
  type RequestCreateEvent,
  type StreamClientEvent,
  type StreamResponseEvent,
  type StreamServerEvent
} from '@actiondriver/runtime-contracts'
import type { AgentGoalRequest } from '@actiondriver/contracts'

type WebSocketConstructor = typeof NodeWebSocket
type Listener = (event: StreamServerEvent) => void

export type RuntimeStreamAccepted = Extract<StreamServerEvent, { type: 'request.accepted' }>

export class RuntimeStreamClient {
  private socket: NodeWebSocket | null = null
  private config: {
    baseUrl: string
    token: string
    streamPath: string
    streamProtocol: string
  } | null = null
  private connectPromise: Promise<void> | null = null
  private resolveConnect: (() => void) | null = null
  private rejectConnect: ((error: Error) => void) | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private intentionallyClosed = false
  private readonly listeners = new Set<Listener>()
  private readonly pendingCreates = new Map<
    string,
    {
      event: RequestCreateEvent
      resolve(value: RuntimeStreamAccepted): void
      reject(error: Error): void
    }
  >()
  private readonly acceptedByTask = new Map<string, RuntimeStreamAccepted>()
  private readonly cursors = new Map<string, number>()
  private readonly activeRequests = new Set<string>()
  private readonly lifecycleGuards = new Map<string, StreamLifecycleGuard>()
  private readonly seenEventIds = new Set<string>()
  private readonly seenOrder: string[] = []

  constructor(
    private readonly options: {
      WebSocket?: WebSocketConstructor
      id?: () => string
      retryDelay?: (attempt: number) => number
      maxSeenEvents?: number
    } = {}
  ) {}

  async connect(input: {
    baseUrl: string
    token: string
    streamPath?: string
    streamProtocol?: string
  }): Promise<void> {
    const nextConfig = {
      baseUrl: input.baseUrl,
      token: input.token,
      streamPath: input.streamPath ?? '/stream',
      streamProtocol: input.streamProtocol ?? STREAM_PROTOCOL
    }
    const changed =
      this.config !== null && JSON.stringify(this.config) !== JSON.stringify(nextConfig)
    this.config = nextConfig
    this.intentionallyClosed = false
    if (changed) {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
      const previous = this.socket
      this.socket = null
      previous?.terminate()
      this.connectPromise = null
      this.resolveConnect = null
      this.rejectConnect = null
    }
    if (this.socket?.readyState === NodeWebSocket.OPEN) return
    if (this.connectPromise) return await this.connectPromise
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve
      this.rejectConnect = reject
    })
    this.open()
    return await this.connectPromise
  }

  async create(
    input: AgentGoalRequest & { systemPrompt?: string }
  ): Promise<RuntimeStreamAccepted> {
    await this.requireReady()
    const requestId = this.nextId()
    const event: RequestCreateEvent = {
      type: 'request.create',
      protocol: STREAM_PROTOCOL,
      eventId: this.nextId(),
      createdAt: new Date().toISOString(),
      requestId,
      idempotencyKey: this.nextId(),
      sessionId: null,
      payload: {
        input: { role: 'user', content: input.goal },
        model: input.model,
        ...(input.systemPrompt === undefined ? {} : { systemPrompt: input.systemPrompt }),
        skills: []
      }
    }
    const accepted = new Promise<RuntimeStreamAccepted>((resolve, reject) => {
      this.pendingCreates.set(requestId, { event, resolve, reject })
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

  subscribe(listener: Listener): () => void {
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
      pending.reject(new Error('Runtime stream client closed'))
    }
    this.pendingCreates.clear()
    if (!socket || socket.readyState === NodeWebSocket.CLOSED) return
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
    socket.close(1000, 'Client shutting down')
    await closed
  }

  private open(): void {
    const config = this.config
    if (!config || this.intentionallyClosed) return
    const WebSocketImpl = this.options.WebSocket ?? NodeWebSocket
    const url = new URL(config.streamPath, config.baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocketImpl(url, [config.streamProtocol])
    this.socket = socket
    socket.on('open', () => {
      this.send({
        type: 'auth',
        protocol: STREAM_PROTOCOL,
        eventId: this.nextId(),
        createdAt: new Date().toISOString(),
        payload: { token: config.token }
      })
    })
    socket.on('message', (raw, isBinary) => {
      if (isBinary) return
      this.receive(raw.toString())
    })
    socket.on('error', () => undefined)
    socket.on('close', (code, reason) => this.handleClose(socket, code, reason.toString()))
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
    if (event.type === 'response.snapshot') {
      this.lifecycleGuards.delete(event.responseId)
    }

    try {
      for (const listener of this.listeners) listener(event)
    } catch {
      return
    }
    this.remember(event.eventId)
    if ('cursor' in event) this.cursors.set(event.requestId, event.cursor)
    if (event.type === 'request.accepted') {
      this.activeRequests.add(event.requestId)
      this.acceptedByTask.set(event.taskId, event)
      this.pendingCreates.get(event.requestId)?.resolve(event)
      this.pendingCreates.delete(event.requestId)
    }
    if (event.type === 'request.error') {
      this.pendingCreates.get(event.requestId)?.reject(new Error(event.error.message))
      this.pendingCreates.delete(event.requestId)
    }
    if (event.type === 'response.end') this.activeRequests.delete(event.requestId)
  }

  private handleClose(socket: NodeWebSocket, code: number, reason: string): void {
    if (this.socket !== socket) return
    this.socket = null
    if (this.intentionallyClosed) return
    if (code === 1008) {
      const error = new Error(reason || 'Runtime stream authentication failed')
      this.rejectConnect?.(error)
      this.connectPromise = null
      this.resolveConnect = null
      this.rejectConnect = null
      for (const pending of this.pendingCreates.values()) pending.reject(error)
      this.pendingCreates.clear()
      return
    }
    this.connectPromise = null
    const delay =
      this.options.retryDelay?.(this.reconnectAttempt) ?? defaultRetryDelay(this.reconnectAttempt)
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.intentionallyClosed) this.open()
    }, delay)
  }

  private resume(requestId: string): void {
    if (this.socket?.readyState !== NodeWebSocket.OPEN) return
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
    if (this.socket?.readyState !== NodeWebSocket.OPEN) {
      throw new Error('Runtime stream is not connected')
    }
    this.socket.send(JSON.stringify(event))
  }

  private async requireReady(): Promise<void> {
    if (this.connectPromise) await this.connectPromise
    if (this.socket?.readyState !== NodeWebSocket.OPEN) {
      throw new Error('Runtime stream is not connected')
    }
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
