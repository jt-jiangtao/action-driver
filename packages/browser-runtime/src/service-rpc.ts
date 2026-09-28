export interface RpcMessage {
  jsonrpc?: string
  id?: unknown
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string } | undefined
}
export interface MessageTransport {
  sendMessage(message: RpcMessage): unknown
  setMessageCallback(callback: (message: RpcMessage) => unknown): unknown
  addCloseListener?(callback: (error?: Error) => unknown): unknown
  close?(): Promise<unknown>
}
type Handler = (params: unknown) => unknown
type Method = string | number | { toString(): string }
export class BrowserRpc {
  nextId = 1
  pendingRequests = new Map<
    unknown,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >()
  requestHandlers = new Map<string, Handler>()
  eventHandlers = new Map<string, Handler[]>()
  constructor(public transport: MessageTransport) {
    transport.setMessageCallback((message) => this.handleIncomingMessage(message))
    transport.addCloseListener?.((error) =>
      this.rejectPendingRequests(error?.message ?? 'transport closed before response')
    )
  }
  registerRequestHandlerObject(handlers: object) {
    const target = handlers as Record<string, unknown>
    for (const name of [
      ...Object.getOwnPropertyNames(target),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(target))
    ])
      if (name !== 'constructor' && typeof target[name] === 'function')
        this.registerRequestHandler(name, (target[name] as Handler).bind(target))
  }
  registerRequestHandler(method: string, handler: Handler) {
    this.requestHandlers.set(method, handler)
  }
  addEventListener(method: Method, handler: Handler) {
    const key = method.toString(),
      handlers = this.eventHandlers.get(key) ?? []
    handlers.push(handler)
    this.eventHandlers.set(key, handlers)
  }
  removeEventListener(method: Method, handler: Handler) {
    const key = method.toString()
    this.eventHandlers.set(
      key,
      (this.eventHandlers.get(key) ?? []).filter((item) => item !== handler)
    )
  }
  sendNotification(method: string, params?: unknown) {
    this.transport.sendMessage({ jsonrpc: '2.0', method, params })
  }
  sendRequest(method: Method, params?: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      try {
        this.transport.sendMessage({ jsonrpc: '2.0', method: method.toString(), params, id })
      } catch (error) {
        this.pendingRequests.delete(id)
        reject(error)
      }
    })
  }
  async handleIncomingMessage(message: RpcMessage) {
    if ('method' in message) return this.handleIncomingRequest(message)
    if (message.id === undefined) return
    const pending = this.pendingRequests.get(message.id)
    if (!pending) return
    this.pendingRequests.delete(message.id)
    if ('error' in message) pending.reject(message.error?.message || 'Something went wrong')
    else pending.resolve(message.result)
  }
  rejectPendingRequests(error: unknown) {
    for (const pending of this.pendingRequests.values()) pending.reject(error)
    this.pendingRequests.clear()
  }
  async handleIncomingRequest(message: RpcMessage) {
    if (message.id === undefined) {
      for (const handler of this.eventHandlers.get(message.method ?? '') ?? [])
        handler(message.params)
      return
    }
    const handler = this.requestHandlers.get(message.method ?? '')
    if (!handler) {
      this.transport.sendMessage({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -1, message: `No handler registered for method: ${message.method}` }
      } as RpcMessage)
      return
    }
    try {
      const result = await handler(message.params)
      this.transport.sendMessage({ jsonrpc: '2.0', id: message.id, result })
    } catch (error) {
      this.transport.sendMessage({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: 1, message: error instanceof Error ? error.message : String(error) }
      } as RpcMessage)
    }
  }
}
