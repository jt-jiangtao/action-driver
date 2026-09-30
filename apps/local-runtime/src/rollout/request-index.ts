import type { PersistedStreamRequest } from '@action-driver/agent-runtime/ports'

/** In-memory lookup projection; insertion order matches the primary request Map. */
export class RolloutRequestIndex {
  private readonly requests = new Map<string, PersistedStreamRequest>()
  private readonly taskIds = new Map<string, string>()
  private readonly idempotencyKeys = new Map<string, string>()

  constructor(requests: Iterable<PersistedStreamRequest> = []) {
    for (const request of requests) this.upsert(request)
  }

  getByRequestId(requestId: string): PersistedStreamRequest | null {
    return this.requests.get(requestId) ?? null
  }

  getByTaskId(taskId: string): PersistedStreamRequest | null {
    const requestId = this.taskIds.get(taskId)
    return requestId === undefined ? null : (this.requests.get(requestId) ?? null)
  }

  getByIdempotencyKey(key: string): PersistedStreamRequest | null {
    const requestId = this.idempotencyKeys.get(key)
    return requestId === undefined ? null : (this.requests.get(requestId) ?? null)
  }

  values(): IterableIterator<PersistedStreamRequest> {
    return this.requests.values()
  }

  upsert(request: PersistedStreamRequest): void {
    const previous = this.requests.get(request.requestId)
    this.requests.set(request.requestId, request)
    if (previous?.taskId !== request.taskId) {
      if (previous && this.taskIds.get(previous.taskId) === request.requestId)
        this.refresh(this.taskIds, previous.taskId, (item) => item.taskId)
      this.insert(this.taskIds, request.taskId, request.requestId, (item) => item.taskId)
    }
    if (previous?.idempotencyKey !== request.idempotencyKey) {
      if (previous && this.idempotencyKeys.get(previous.idempotencyKey) === request.requestId)
        this.refresh(this.idempotencyKeys, previous.idempotencyKey, (item) => item.idempotencyKey)
      this.insert(
        this.idempotencyKeys,
        request.idempotencyKey,
        request.requestId,
        (item) => item.idempotencyKey
      )
    }
  }

  private insert(
    index: Map<string, string>,
    key: string,
    requestId: string,
    select: (request: PersistedStreamRequest) => string
  ): void {
    if (!index.has(key)) index.set(key, requestId)
    else if (index.get(key) !== requestId) this.refresh(index, key, select)
  }

  private refresh(
    index: Map<string, string>,
    key: string,
    select: (request: PersistedStreamRequest) => string
  ): void {
    index.delete(key)
    for (const request of this.requests.values()) {
      if (select(request) !== key) continue
      index.set(key, request.requestId)
      break
    }
  }
}
