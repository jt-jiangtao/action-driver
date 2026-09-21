import type {
  RuntimeCommandMap,
  RuntimeEvent,
  SkillExecuteRequest,
  SkillExecuteResult
} from './protocol'
import { RUNTIME_PROTOCOL_VERSION } from './protocol'
import { parseRuntimeEnvelope, type RuntimeEnvelope } from './schemas'

export type RuntimeMessageListener = (message: unknown) => void

export interface RuntimeMessageEndpoint {
  postMessage(message: unknown): void
  onMessage(listener: RuntimeMessageListener): () => void
  onClose(listener: () => void): () => void
}

export type RuntimeRpcErrorCode =
  | 'HANDSHAKE_REQUIRED'
  | 'HANDSHAKE_REJECTED'
  | 'DEADLINE_EXCEEDED'
  | 'INVALID_MESSAGE'
  | 'RUNTIME_DISCONNECTED'
  | 'REMOTE_ERROR'
  | 'LATE_RESPONSE'

export class RuntimeRpcError extends Error {
  constructor(
    readonly code: RuntimeRpcErrorCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'RuntimeRpcError'
  }
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: RuntimeRpcError) => void
  timer: ReturnType<typeof setTimeout>
}

type RequestOptions = { deadlineUnixMs?: number }

type RuntimeClientOptions = {
  appVersion: string
  capabilities: readonly string[]
  onSkillExecute: (request: SkillExecuteRequest) => SkillExecuteResult | unknown | Promise<unknown>
  requestIdFactory?: () => string
  now?: () => number
  defaultTimeoutMs?: number
  onDiagnostic?: (error: RuntimeRpcError) => void
}

type RuntimeServerOptions = {
  runtimeVersion: string
  capabilities: readonly string[]
  onCommand: (command: string, input: unknown) => unknown | Promise<unknown>
  readEvents?: (taskId: string, afterCursor: number) => RuntimeEvent[] | Promise<RuntimeEvent[]>
  requestIdFactory?: () => string
  now?: () => number
  defaultTimeoutMs?: number
  onDiagnostic?: (error: RuntimeRpcError) => void
}

export type RuntimeHandshake = {
  runtimeVersion: string
  capabilities: string[]
}

export type RuntimeEventSubscription = {
  readonly subscriptionId: string
  readonly cursor: number
}

type EventSubscriptionState = {
  taskId: string
  cursor: number
  onEvent: (event: RuntimeEvent) => void
}

type ServerEventSubscriptionState = {
  taskId: string
  cursor: number
  replaying: boolean
  queued: RuntimeEvent[]
}

function defaultRequestId(): string {
  return globalThis.crypto.randomUUID()
}

function toErrorPayload(error: unknown): { code: string; message: string; details?: unknown } {
  if (error instanceof RuntimeRpcError) {
    return error.details === undefined
      ? { code: error.code, message: error.message }
      : { code: error.code, message: error.message, details: error.details }
  }
  return { code: 'REMOTE_ERROR', message: error instanceof Error ? error.message : String(error) }
}

function fromErrorPayload(payload: { code: string; message: string; details?: unknown }): RuntimeRpcError {
  const knownCodes: readonly RuntimeRpcErrorCode[] = [
    'HANDSHAKE_REQUIRED',
    'HANDSHAKE_REJECTED',
    'DEADLINE_EXCEEDED',
    'INVALID_MESSAGE',
    'RUNTIME_DISCONNECTED',
    'REMOTE_ERROR',
    'LATE_RESPONSE'
  ]
  return new RuntimeRpcError(
    knownCodes.includes(payload.code as RuntimeRpcErrorCode)
      ? (payload.code as RuntimeRpcErrorCode)
      : 'REMOTE_ERROR',
    payload.message,
    payload.details
  )
}

abstract class RpcPeer {
  protected readonly pending = new Map<string, PendingRequest>()
  protected readonly now: () => number
  protected readonly defaultTimeoutMs: number
  protected readonly requestIdFactory: () => string
  protected readonly onDiagnostic: (error: RuntimeRpcError) => void
  private disconnected = false

  protected constructor(
    protected readonly endpoint: RuntimeMessageEndpoint,
    options: {
      now?: () => number
      defaultTimeoutMs?: number
      requestIdFactory?: () => string
      onDiagnostic?: (error: RuntimeRpcError) => void
    }
  ) {
    this.now = options.now ?? Date.now
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000
    this.requestIdFactory = options.requestIdFactory ?? defaultRequestId
    this.onDiagnostic = options.onDiagnostic ?? (() => undefined)
    endpoint.onClose(() => this.handleDisconnect())
  }

  protected sendPending(
    requestId: string,
    deadlineUnixMs: number,
    envelope: RuntimeEnvelope
  ): Promise<unknown> {
    if (this.disconnected) {
      return Promise.reject(
        new RuntimeRpcError('RUNTIME_DISCONNECTED', 'Runtime message channel is disconnected')
      )
    }
    if (deadlineUnixMs <= this.now()) {
      return Promise.reject(new RuntimeRpcError('DEADLINE_EXCEEDED', 'Request deadline has passed'))
    }
    if (this.pending.has(requestId)) {
      return Promise.reject(
        new RuntimeRpcError('INVALID_MESSAGE', `Duplicate request id ${requestId}`)
      )
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return
        reject(new RuntimeRpcError('DEADLINE_EXCEEDED', `Request ${requestId} exceeded its deadline`))
      }, Math.max(0, deadlineUnixMs - this.now()))
      this.pending.set(requestId, { resolve, reject, timer })
      try {
        this.endpoint.postMessage(envelope)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(
          new RuntimeRpcError('RUNTIME_DISCONNECTED', 'Failed to send runtime message', error)
        )
      }
    })
  }

  protected settleResponse(
    requestId: string,
    payload: {
      ok: boolean
      value?: unknown
      error?: { code: string; message: string; details?: unknown } | undefined
    }
  ): void {
    const pending = this.pending.get(requestId)
    if (!pending) {
      this.onDiagnostic(new RuntimeRpcError('LATE_RESPONSE', `Ignored response for ${requestId}`))
      return
    }
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    if (payload.ok) pending.resolve(payload.value)
    else
      pending.reject(
        fromErrorPayload(payload.error ?? { code: 'REMOTE_ERROR', message: 'Remote request failed' })
      )
  }

  protected parse(message: unknown): RuntimeEnvelope | null {
    try {
      return parseRuntimeEnvelope(message)
    } catch (error) {
      this.onDiagnostic(new RuntimeRpcError('INVALID_MESSAGE', 'Rejected invalid runtime message', error))
      return null
    }
  }

  protected deadline(options?: RequestOptions): number {
    return options?.deadlineUnixMs ?? this.now() + this.defaultTimeoutMs
  }

  protected postResponse(envelope: RuntimeEnvelope): void {
    try {
      this.endpoint.postMessage(envelope)
    } catch (error) {
      this.onDiagnostic(
        new RuntimeRpcError('RUNTIME_DISCONNECTED', 'Failed to send runtime response', error)
      )
    }
  }

  private handleDisconnect(): void {
    if (this.disconnected) return
    this.disconnected = true
    const error = new RuntimeRpcError(
      'RUNTIME_DISCONNECTED',
      'Runtime message channel disconnected'
    )
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

export class RuntimeClient extends RpcPeer {
  private connected = false
  private readonly subscriptions = new Map<string, EventSubscriptionState>()

  constructor(
    endpoint: RuntimeMessageEndpoint,
    private readonly options: RuntimeClientOptions
  ) {
    super(endpoint, options)
    endpoint.onMessage((message) => void this.handleMessage(message))
  }

  async connect(options?: RequestOptions): Promise<RuntimeHandshake> {
    const requestId = this.requestIdFactory()
    const result = await this.sendPending(requestId, this.deadline(options), {
      type: 'handshake.request',
      requestId,
      version: RUNTIME_PROTOCOL_VERSION,
      payload: {
        appVersion: this.options.appVersion,
        capabilities: [...this.options.capabilities]
      }
    })
    this.connected = true
    return result as RuntimeHandshake
  }

  request<TCommand extends keyof RuntimeCommandMap>(
    command: TCommand,
    input: RuntimeCommandMap[TCommand]['request'],
    options?: RequestOptions
  ): Promise<RuntimeCommandMap[TCommand]['response']> {
    if (!this.connected) {
      return Promise.reject(
        new RuntimeRpcError('HANDSHAKE_REQUIRED', 'Runtime handshake must complete first')
      )
    }
    const requestId = this.requestIdFactory()
    const deadlineUnixMs = this.deadline(options)
    return this.sendPending(requestId, deadlineUnixMs, {
      type: 'command.request',
      requestId,
      version: RUNTIME_PROTOCOL_VERSION,
      deadlineUnixMs,
      payload: { command, input }
    }) as Promise<RuntimeCommandMap[TCommand]['response']>
  }

  async subscribeEvents(
    taskId: string,
    afterCursor: number,
    onEvent: (event: RuntimeEvent) => void,
    options?: RequestOptions
  ): Promise<RuntimeEventSubscription> {
    if (!this.connected) {
      throw new RuntimeRpcError('HANDSHAKE_REQUIRED', 'Runtime handshake must complete first')
    }
    const requestId = this.requestIdFactory()
    const deadlineUnixMs = this.deadline(options)
    const state: EventSubscriptionState = { taskId, cursor: afterCursor, onEvent }
    this.subscriptions.set(requestId, state)
    try {
      await this.sendPending(requestId, deadlineUnixMs, {
        type: 'event.subscribe',
        requestId,
        version: RUNTIME_PROTOCOL_VERSION,
        deadlineUnixMs,
        payload: { taskId, afterCursor }
      })
    } catch (error) {
      this.subscriptions.delete(requestId)
      throw error
    }
    return {
      subscriptionId: requestId,
      get cursor() {
        return state.cursor
      }
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    const envelope = this.parse(message)
    if (!envelope) return
    if (envelope.type === 'handshake.response') {
      this.settleResponse(envelope.requestId, {
        ok: envelope.payload.ok,
        value: {
          runtimeVersion: envelope.payload.runtimeVersion,
          capabilities: envelope.payload.capabilities
        },
        ...(envelope.payload.error ? { error: envelope.payload.error } : {})
      })
      return
    }
    if (envelope.type === 'command.response') {
      this.settleResponse(envelope.requestId, envelope.payload)
      return
    }
    if (envelope.type === 'event.ack') {
      this.settleResponse(envelope.requestId, {
        ok: envelope.payload.ok,
        value: { cursor: envelope.payload.cursor },
        ...(envelope.payload.error ? { error: envelope.payload.error } : {})
      })
      return
    }
    if (envelope.type === 'event.item') {
      const subscription = this.subscriptions.get(envelope.requestId)
      if (
        !subscription ||
        envelope.payload.event.taskId !== subscription.taskId ||
        envelope.payload.event.cursor !== envelope.payload.cursor ||
        envelope.payload.cursor <= subscription.cursor
      ) {
        if (envelope.payload.event.cursor !== envelope.payload.cursor) {
          this.onDiagnostic(
            new RuntimeRpcError('INVALID_MESSAGE', 'Event envelope cursor does not match event cursor')
          )
        }
        return
      }
      subscription.cursor = envelope.payload.cursor
      subscription.onEvent(envelope.payload.event)
      return
    }
    if (envelope.type !== 'skill.execute') return

    let payload: { ok: boolean; value?: unknown; error?: ReturnType<typeof toErrorPayload> }
    if (envelope.deadlineUnixMs <= this.now()) {
      payload = {
        ok: false,
        error: toErrorPayload(
          new RuntimeRpcError('DEADLINE_EXCEEDED', 'Skill request deadline has passed')
        )
      }
    } else {
      try {
        payload = { ok: true, value: await this.options.onSkillExecute(envelope.payload) }
      } catch (error) {
        payload = { ok: false, error: toErrorPayload(error) }
      }
    }
    this.postResponse({
      type: 'skill.result',
      requestId: envelope.requestId,
      version: RUNTIME_PROTOCOL_VERSION,
      payload
    } satisfies RuntimeEnvelope)
  }
}

export class RuntimeServer extends RpcPeer {
  private connected = false
  private readonly subscriptions = new Map<string, ServerEventSubscriptionState>()

  constructor(
    endpoint: RuntimeMessageEndpoint,
    private readonly options: RuntimeServerOptions
  ) {
    super(endpoint, options)
    endpoint.onMessage((message) => void this.handleMessage(message))
  }

  requestSkill(request: SkillExecuteRequest, options?: RequestOptions): Promise<SkillExecuteResult> {
    if (!this.connected) {
      return Promise.reject(
        new RuntimeRpcError('HANDSHAKE_REQUIRED', 'Runtime handshake must complete first')
      )
    }
    const requestId = this.requestIdFactory()
    const deadlineUnixMs = this.deadline(options)
    return this.sendPending(requestId, deadlineUnixMs, {
      type: 'skill.execute',
      requestId,
      version: RUNTIME_PROTOCOL_VERSION,
      deadlineUnixMs,
      payload: request
    }) as Promise<SkillExecuteResult>
  }

  publishEvent(event: RuntimeEvent): void {
    for (const [subscriptionId, subscription] of this.subscriptions) {
      if (subscription.taskId !== event.taskId || event.cursor <= subscription.cursor) continue
      if (subscription.replaying) subscription.queued.push(event)
      else this.emitEvent(subscriptionId, subscription, event)
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    const envelope = this.parse(message)
    if (!envelope) return
    if (envelope.type === 'handshake.request') {
      const capabilities = this.options.capabilities.filter((capability) =>
        envelope.payload.capabilities.includes(capability)
      )
      this.connected = true
      this.postResponse({
        type: 'handshake.response',
        requestId: envelope.requestId,
        version: RUNTIME_PROTOCOL_VERSION,
        payload: {
          ok: true,
          runtimeVersion: this.options.runtimeVersion,
          capabilities
        }
      } satisfies RuntimeEnvelope)
      return
    }
    if (envelope.type === 'skill.result') {
      this.settleResponse(envelope.requestId, envelope.payload)
      return
    }
    if (envelope.type === 'event.subscribe') {
      await this.handleEventSubscribe(envelope)
      return
    }
    if (envelope.type !== 'command.request') return

    let payload: { ok: boolean; value?: unknown; error?: ReturnType<typeof toErrorPayload> }
    if (!this.connected) {
      payload = {
        ok: false,
        error: toErrorPayload(
          new RuntimeRpcError('HANDSHAKE_REQUIRED', 'Runtime handshake must complete first')
        )
      }
    } else if (envelope.deadlineUnixMs <= this.now()) {
      payload = {
        ok: false,
        error: toErrorPayload(new RuntimeRpcError('DEADLINE_EXCEEDED', 'Request deadline has passed'))
      }
    } else {
      try {
        payload = {
          ok: true,
          value: await this.options.onCommand(envelope.payload.command, envelope.payload.input)
        }
      } catch (error) {
        payload = { ok: false, error: toErrorPayload(error) }
      }
    }
    this.postResponse({
      type: 'command.response',
      requestId: envelope.requestId,
      version: RUNTIME_PROTOCOL_VERSION,
      payload
    } satisfies RuntimeEnvelope)
  }

  private async handleEventSubscribe(
    envelope: Extract<RuntimeEnvelope, { type: 'event.subscribe' }>
  ): Promise<void> {
    let error: RuntimeRpcError | null = null
    if (!this.connected) {
      error = new RuntimeRpcError('HANDSHAKE_REQUIRED', 'Runtime handshake must complete first')
    } else if (envelope.deadlineUnixMs <= this.now()) {
      error = new RuntimeRpcError('DEADLINE_EXCEEDED', 'Subscription deadline has passed')
    }
    if (error) {
      this.postResponse({
        type: 'event.ack',
        requestId: envelope.requestId,
        version: RUNTIME_PROTOCOL_VERSION,
        payload: {
          ok: false,
          cursor: envelope.payload.afterCursor,
          error: toErrorPayload(error)
        }
      })
      return
    }

    const subscription: ServerEventSubscriptionState = {
      taskId: envelope.payload.taskId,
      cursor: envelope.payload.afterCursor,
      replaying: true,
      queued: []
    }
    this.subscriptions.set(envelope.requestId, subscription)
    let events: RuntimeEvent[]
    try {
      events = await (this.options.readEvents?.(
        envelope.payload.taskId,
        envelope.payload.afterCursor
      ) ?? [])
    } catch (readError) {
      this.subscriptions.delete(envelope.requestId)
      this.postResponse({
        type: 'event.ack',
        requestId: envelope.requestId,
        version: RUNTIME_PROTOCOL_VERSION,
        payload: {
          ok: false,
          cursor: envelope.payload.afterCursor,
          error: toErrorPayload(readError)
        }
      })
      return
    }
    this.postResponse({
      type: 'event.ack',
      requestId: envelope.requestId,
      version: RUNTIME_PROTOCOL_VERSION,
      payload: { ok: true, cursor: envelope.payload.afterCursor }
    })
    for (const event of [...events].sort((left, right) => left.cursor - right.cursor)) {
      this.emitEvent(envelope.requestId, subscription, event)
    }
    subscription.replaying = false
    for (const event of subscription.queued.sort((left, right) => left.cursor - right.cursor)) {
      this.emitEvent(envelope.requestId, subscription, event)
    }
    subscription.queued.length = 0
  }

  private emitEvent(
    subscriptionId: string,
    subscription: ServerEventSubscriptionState,
    event: RuntimeEvent
  ): void {
    if (
      subscription.taskId !== event.taskId ||
      event.cursor <= subscription.cursor
    ) {
      return
    }
    subscription.cursor = event.cursor
    this.postResponse({
      type: 'event.item',
      requestId: subscriptionId,
      version: RUNTIME_PROTOCOL_VERSION,
      payload: { cursor: event.cursor, event }
    })
  }
}
