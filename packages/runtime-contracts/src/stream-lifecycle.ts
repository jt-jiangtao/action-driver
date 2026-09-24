import type { StreamResponseEvent } from './stream-protocol'

export type StreamProtocolErrorCode =
  | 'DUPLICATE_START'
  | 'CONTENT_BEFORE_START'
  | 'END_BEFORE_START'
  | 'EVENT_AFTER_END'

export class StreamProtocolError extends Error {
  constructor(
    readonly code: StreamProtocolErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'StreamProtocolError'
  }
}

type ResponseState = {
  started: boolean
  ended: boolean
}

export class StreamLifecycleGuard {
  private readonly appliedEventIds = new Set<string>()
  private readonly responses = new Map<string, ResponseState>()

  restoreStarted(responseId: string): void {
    if (!this.responses.has(responseId))
      this.responses.set(responseId, { started: true, ended: false })
  }

  apply(event: StreamResponseEvent): 'applied' | 'duplicate' {
    if (this.appliedEventIds.has(event.eventId)) return 'duplicate'

    const current = this.responses.get(event.responseId)
    if (current?.ended) {
      throw new StreamProtocolError(
        'EVENT_AFTER_END',
        `Response ${event.responseId} already reached a terminal event`
      )
    }

    if (event.type === 'response.start') {
      if (current?.started) {
        throw new StreamProtocolError(
          'DUPLICATE_START',
          `Response ${event.responseId} already started`
        )
      }
      this.responses.set(event.responseId, {
        started: true,
        ended: false
      })
      this.appliedEventIds.add(event.eventId)
      return 'applied'
    }

    if (!current?.started) {
      throw new StreamProtocolError(
        event.type === 'response.content' ? 'CONTENT_BEFORE_START' : 'END_BEFORE_START',
        `Response ${event.responseId} has not started`
      )
    }

    if (event.type === 'response.end') current.ended = true
    this.appliedEventIds.add(event.eventId)
    return 'applied'
  }
}
