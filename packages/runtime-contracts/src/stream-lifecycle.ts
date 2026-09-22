import type { StreamResponseEvent } from './stream-protocol'

export type StreamProtocolErrorCode =
  | 'DUPLICATE_START'
  | 'CONTENT_BEFORE_START'
  | 'END_BEFORE_START'
  | 'SEQUENCE_GAP'
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
  lastSequence: number
}

export class StreamLifecycleGuard {
  private readonly appliedEventIds = new Set<string>()
  private readonly responses = new Map<string, ResponseState>()

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
        ended: false,
        lastSequence: event.sequence
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

    const expectedSequence = current.lastSequence + 1
    if (event.sequence !== expectedSequence) {
      throw new StreamProtocolError(
        'SEQUENCE_GAP',
        `Response ${event.responseId} expected sequence ${expectedSequence}, received ${event.sequence}`
      )
    }

    current.lastSequence = event.sequence
    if (event.type === 'response.end') current.ended = true
    this.appliedEventIds.add(event.eventId)
    return 'applied'
  }
}
