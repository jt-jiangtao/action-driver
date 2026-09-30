import { describe, expect, it, vi } from 'vitest'
import type { PersistedStreamRequest } from '@action-driver/agent-runtime/ports'
import { applyRolloutLine, emptyRolloutState } from '../../../src/rollout/fold'
import { deriveRolloutEvents, deriveRolloutEventsForLine } from '../../../src/rollout/event-bridge'
import type { RolloutLine } from '../../../src/rollout/model'
import { RequestEventViews } from '../../../src/rollout/request-event-view'

const request: PersistedStreamRequest = {
  requestId: 'request',
  taskId: 'task',
  sessionId: 'session',
  idempotencyKey: 'key',
  responseId: 'response',
  streamId: 'stream',
  messageId: 'message',
  status: 'running',
  lastSequence: -1,
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z'
}
const ts = request.createdAt
const lines: RolloutLine[] = [
  {
    t: 'session_meta',
    seq: 0,
    ts,
    sessionId: 'session',
    threadId: 'session',
    model: { connectionId: 'connection', modelId: 'model' },
    originator: 'test',
    version: '1'
  },
  { t: 'event', seq: 1, ts, turnId: 'task', type: 'request.accepted', payload: {} },
  { t: 'turn_begin', seq: 2, ts, turnId: 'task', taskId: 'task', goal: 'test' },
  { t: 'event', seq: 3, ts, turnId: 'other', type: 'other.event', payload: {} },
  { t: 'event', seq: 4, ts, turnId: 'task', type: 'benchmark.tick', payload: { value: '中文' } }
]

describe('request event view', () => {
  it('derives identical event fields through full replay and post-fold incremental lines', () => {
    const state = emptyRolloutState()
    const incremental = []
    for (const line of lines) {
      applyRolloutLine(state, line)
      incremental.push(...deriveRolloutEventsForLine(line, request, state, incremental.length))
    }
    expect(incremental).toEqual(deriveRolloutEvents(lines, request))
    expect(incremental.map((event) => [event.cursor, event.sequence])).toEqual([
      [1, 0],
      [2, 1],
      [4, 2]
    ])
  })

  it('reuses pages, tracks interleaved append, and invalidates changed metadata or cursor', () => {
    const views = new RequestEventViews()
    const state = emptyRolloutState()
    const existing: RolloutLine[] = []
    for (const line of lines.slice(0, 3)) {
      existing.push(line)
      applyRolloutLine(state, line)
    }
    const first = views.listAfter(request, existing, 0, 2)
    expect(views.listAfter(request, existing, 0, 2)).toEqual(first)
    for (const line of lines.slice(3)) {
      existing.push(line)
      applyRolloutLine(state, line)
      views.append(line, state, (id) => (id === request.requestId ? request : null))
    }
    expect(views.listAfter(request, existing, 0, 100)).toEqual(
      deriveRolloutEvents(existing, request)
    )
    expect(views.listAfter(request, existing, 2, 100).map((event) => event.sequence)).toEqual([2])
    const changed = { ...request, messageId: 'new-message' }
    expect(views.listAfter(changed, existing, 0, 100)).toEqual(
      deriveRolloutEvents(existing, changed)
    )
    expect(views.listAfter(changed, existing.slice(0, 3), 0, 100)).toEqual(
      deriveRolloutEvents(existing.slice(0, 3), changed)
    )
  })

  it('evicts at request and byte limits and rebuilds from the log', () => {
    const second = { ...request, requestId: 'second', taskId: 'other' }
    const views = new RequestEventViews({ maxRequests: 1, maxBytes: 1_000_000 })
    const first = views.listAfter(request, lines, 0, 100)
    views.listAfter(second, lines, 0, 100)
    expect(views.listAfter(request, lines, 0, 100)).toEqual(first)
    expect(views.listAfter(request, lines, 0, 100)).toEqual(first)
    const uncached = new RequestEventViews({ maxRequests: 1, maxBytes: 1 })
    expect(uncached.listAfter(request, lines, 0, 100)).toEqual(first)
    expect(uncached.listAfter(request, lines, 0, 100)).toEqual(first)
  })

  it('keeps the first reopened page cold and caches subsequent pages', () => {
    const views = new RequestEventViews()
    const cold = views.listAfter(request, lines, 0, 2, true)
    const warm = views.listAfter(request, lines, 0, 2, true)
    expect(warm).toEqual(cold)
    const stringify = vi.spyOn(JSON, 'stringify')
    try {
      expect(views.listAfter(request, lines, 0, 2, true)).toEqual(warm)
      expect(
        stringify.mock.calls.some(
          ([value]) => value !== null && typeof value === 'object' && 'cursor' in value
        )
      ).toBe(false)
    } finally {
      stringify.mockRestore()
    }
  })

  it('avoids repeated size serialization when a request is over the byte limit', () => {
    const oversizedLines: RolloutLine[] = [lines[0]!]
    for (let index = 1; index <= 20; index += 1)
      oversizedLines.push({
        t: 'event',
        seq: index,
        ts,
        turnId: 'task',
        type: 'large.event',
        payload: { value: '字'.repeat(1000) }
      })
    const views = new RequestEventViews({ maxBytes: 1024 })
    const expected = deriveRolloutEvents(oversizedLines, request)
    expect(views.listAfter(request, oversizedLines, 0, 5)).toEqual(expected.slice(0, 5))
    const stringify = vi.spyOn(JSON, 'stringify')
    try {
      expect(views.listAfter(request, oversizedLines, 5, 5)).toEqual(expected.slice(5, 10))
      expect(
        stringify.mock.calls.some(([value]) => Array.isArray(value) && value.length === 20)
      ).toBe(false)
      expect(
        stringify.mock.calls.some(
          ([value]) => value !== null && typeof value === 'object' && 'cursor' in value
        )
      ).toBe(false)
    } finally {
      stringify.mockRestore()
    }
  })

  it('enforces the serialized byte ceiling when a new event needs a separator', () => {
    const existing = lines.slice(0, 3)
    const state = emptyRolloutState()
    for (const line of existing) applyRolloutLine(state, line)
    const added = { ...lines[4]!, seq: 3 } as RolloutLine
    const original = deriveRolloutEvents(existing, request)
    applyRolloutLine(state, added)
    const next = deriveRolloutEventsForLine(added, request, state, original.length)[0]!
    const maxBytes =
      Buffer.byteLength(JSON.stringify(original)) + Buffer.byteLength(JSON.stringify(next))
    const views = new RequestEventViews({ maxBytes })
    views.listAfter(request, existing, 0, 100)
    existing.push(added)
    views.append(added, state, (id) => (id === request.requestId ? request : null))
    const stringify = vi.spyOn(JSON, 'stringify')
    try {
      expect(views.listAfter(request, existing, 0, 100)).toEqual([...original, next])
      expect(
        stringify.mock.calls.some(
          ([value]) => value !== null && typeof value === 'object' && 'cursor' in value
        )
      ).toBe(true)
    } finally {
      stringify.mockRestore()
    }
  })

  it('does not let a caller mutate cached event metadata used by later pages', () => {
    const views = new RequestEventViews()
    const first = views.listAfter(request, lines, 0, 2)
    first[0]!.type = 'caller.changed'
    first[0]!.sequence = 999
    expect(views.listAfter(request, lines, 0, 2)).toEqual(
      deriveRolloutEvents(lines, request).slice(0, 2)
    )
  })
})
