import { describe, expect, it, vi } from 'vitest'
import { AppApprovalBroker, type AppPolicy, type AppApprovalEvent } from './app-approval-broker'

const policy: AppPolicy = {
  decision: 'allowed',
  allowPersistentApproval: true,
  target: {
    bundleId: 'com.apple.Notes',
    displayName: 'Notes',
    appPath: '/System/Applications/Notes.app',
    risk: 'low'
  }
}
const context = { taskId: 'task', sessionId: 'session' }
function harness(selected: AppPolicy = policy) {
  const requested: Array<{ requestId: string; taskId: string }> = []
  const persisted = new Set<string>()
  const query = vi.fn(async () => selected)
  const suspend = vi.fn(async (_taskId: string, wait: () => Promise<void>) => await wait())
  const broker = new AppApprovalBroker({
    queryPolicy: query,
    withSuspendedTimeout: suspend,
    isAlwaysAllowed: async (id) => persisted.has(id),
    persistAlwaysAllowed: async (id) => {
      persisted.add(id)
    },
    emit: (event) => {
      if (event.type === 'computer.app-approval.requested') requested.push(event.request)
    }
  })
  return { broker, query, requested, persisted, suspend }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('AppApprovalBroker', () => {
  it('approves the trusted policy already queried by the original sky wrapper', async () => {
    const h = harness()
    const supplied = structuredClone(policy)
    const waiting = h.broker.requestApproval(context, supplied)
    supplied.target.appPath = '/Applications/Other.app'
    await settle()
    expect(h.broker.getPending('task')[0]?.target.appPath).toBe(policy.target.appPath)
    await h.broker.decide('task', h.requested[0]!.requestId, 'session')
    await waiting
    await h.broker.requestApproval({ taskId: 'next', sessionId: 'session' }, policy)
    expect(h.query).not.toHaveBeenCalled()
    expect(h.requested).toHaveLength(1)
  })
  it('blocks until approval and binds frozen input to the resolved application path', async () => {
    const h = harness()
    const input = { app: 'Notes', text: 'original' }
    const waiting = h.broker.authorize(context, input)
    input.text = 'changed'
    await settle()
    expect(h.requested).toHaveLength(1)
    expect(h.suspend).toHaveBeenCalledTimes(1)
    await h.broker.decide('task', h.requested[0]!.requestId, 'once')
    const result = await waiting
    expect(result).toEqual({ app: policy.target.appPath, text: 'original' })
    expect(Object.isFrozen(result)).toBe(true)
  })
  it('retains session approval across tasks while still querying policy each time', async () => {
    const h = harness()
    const waiting = h.broker.authorize(context, { app: 'Notes' })
    await settle()
    await h.broker.decide('task', h.requested[0]!.requestId, 'session')
    await waiting
    await h.broker.authorize({ taskId: 'next', sessionId: 'session' }, { app: 'Notes' })
    expect(h.query).toHaveBeenCalledTimes(2)
    expect(h.requested).toHaveLength(1)
  })
  it('only approves one call when once is selected', async () => {
    const h = harness()
    const first = h.broker.authorize(context, { app: 'Notes' })
    await settle()
    await h.broker.decide('task', h.requested[0]!.requestId, 'once')
    await first
    const second = h.broker.authorize(context, { app: 'Notes' })
    const rejected = expect(second).rejects.toThrow('CANCELLED')
    await settle()
    expect(h.requested).toHaveLength(2)
    h.broker.cancelTask('task')
    await rejected
  })
  it.each(['forbidden', 'denied'] as const)('rejects %s without asking', async (decision) => {
    const h = harness({ ...policy, decision })
    await expect(h.broker.authorize(context, { app: 'Notes' })).rejects.toThrow(
      decision === 'forbidden' ? 'APP_FORBIDDEN' : 'APP_DENIED'
    )
    expect(h.requested).toHaveLength(0)
  })
  it('rejects foreign-task and duplicate decisions', async () => {
    const h = harness()
    const waiting = h.broker.authorize(context, { app: 'Notes' })
    await settle()
    const id = h.requested[0]!.requestId
    await expect(h.broker.decide('other', id, 'session')).rejects.toThrow('APPROVAL_STALE')
    await h.broker.decide('task', id, 'session')
    await waiting
    await expect(h.broker.decide('task', id, 'session')).rejects.toThrow('APPROVAL_STALE')
  })
  it('rejects accessor arguments without executing them', async () => {
    const h = harness()
    const getter = vi.fn(() => 'Notes')
    await expect(
      h.broker.authorize(context, Object.defineProperty({}, 'app', { get: getter }))
    ).rejects.toThrow('INVALID_REQUEST')
    expect(getter).not.toHaveBeenCalled()
    expect(h.query).not.toHaveBeenCalled()
  })
  it('persists always approval and uses it in another session', async () => {
    const h = harness()
    const waiting = h.broker.authorize(context, { app: 'Notes' })
    await settle()
    await h.broker.decide('task', h.requested[0]!.requestId, 'always')
    await waiting
    expect(h.persisted.has(policy.target.bundleId)).toBe(true)
    await h.broker.authorize({ taskId: 'other', sessionId: 'other' }, { app: 'Notes' })
    expect(h.requested).toHaveLength(1)
  })
  it('cancels a pending approval when its signal aborts', async () => {
    const h = harness()
    const abort = new AbortController()
    const waiting = h.broker.authorize(context, { app: 'Notes' }, abort.signal)
    const rejected = expect(waiting).rejects.toThrow('CANCELLED')
    await settle()
    abort.abort()
    await rejected
    await expect(h.broker.decide('task', h.requested[0]!.requestId, 'once')).rejects.toThrow(
      'APPROVAL_STALE'
    )
  })
})

describe('approval cancellation and policy changes', () => {
  it('orders a reentrant decision after the asynchronous request publication', async () => {
    let release!: () => void
    const publication = new Promise<void>((resolve) => {
      release = resolve
    })
    const events: string[] = []
    let decision!: Promise<void>
    const broker = new AppApprovalBroker({
      queryPolicy: async () => policy,
      isAlwaysAllowed: async () => false,
      persistAlwaysAllowed: async () => {},
      withSuspendedTimeout: async (_, wait) => wait(),
      emit: (event) => {
        events.push(event.type)
        if (event.type === 'computer.app-approval.requested') {
          decision = broker.decide('task', event.request.requestId, 'once')
          return publication
        }
      }
    })
    const waiting = broker.authorize(context, { app: 'Notes' })
    await settle()
    expect(events).toEqual(['computer.app-approval.requested'])
    release()
    await decision
    await waiting
    expect(events).toEqual(['computer.app-approval.requested', 'computer.app-approval.resolved'])
  })
  it('waits for the same cancellation publication across concurrent task cleanup calls', async () => {
    let release!: () => void
    const publication = new Promise<void>((resolve) => {
      release = resolve
    })
    let cancellations = 0
    const broker = new AppApprovalBroker({
      queryPolicy: async () => policy,
      isAlwaysAllowed: async () => false,
      persistAlwaysAllowed: async () => {},
      withSuspendedTimeout: async (_, wait) => wait(),
      emit: (event) => {
        if (event.type === 'computer.app-approval.resolved') {
          cancellations++
          return publication
        }
      }
    })
    const waiting = broker.authorize(context, { app: 'Notes' }).catch((error) => error.message)
    await settle()
    const first = broker.cancelTask('task')
    let secondFinished = false
    const second = broker.cancelTask('task').then(() => {
      secondFinished = true
    })
    await settle()
    expect(secondFinished).toBe(false)
    expect(broker.getPending('task')).toEqual([])
    release()
    await Promise.all([first, second])
    expect(await waiting).toContain('CANCELLED')
    expect(cancellations).toBe(1)
  })
  it('waits for asynchronous resolved publication before authorizing the call', async () => {
    let release!: () => void
    const published = new Promise<void>((resolve) => {
      release = resolve
    })
    const events: AppApprovalEvent[] = []
    const broker = new AppApprovalBroker({
      queryPolicy: async () => policy,
      isAlwaysAllowed: async () => false,
      persistAlwaysAllowed: async () => {},
      withSuspendedTimeout: async (_, wait) => wait(),
      emit: async (event) => {
        events.push(event)
        if (event.type === 'computer.app-approval.resolved') await published
      }
    })
    let authorized = false
    const waiting = broker.authorize(context, { app: 'Notes' }).then(() => {
      authorized = true
    })
    await settle()
    const decision = broker.decide('task', events[0]!.request.requestId, 'session')
    await settle()
    expect(authorized).toBe(false)
    release()
    await decision
    await waiting
    expect(authorized).toBe(true)
  })
  it('rejects asynchronous request publication failure and removes the pending request', async () => {
    const broker = new AppApprovalBroker({
      queryPolicy: async () => policy,
      isAlwaysAllowed: async () => false,
      persistAlwaysAllowed: async () => {},
      withSuspendedTimeout: async (_, wait) => wait(),
      emit: async () => {
        throw new Error('publication failed')
      }
    })
    await expect(broker.authorize(context, { app: 'Notes' })).rejects.toThrow('publication failed')
    expect(broker.getPending('task')).toEqual([])
  })
  it('does not grant access when resolved publication fails', async () => {
    const broker = new AppApprovalBroker({
      queryPolicy: async () => policy,
      isAlwaysAllowed: async () => false,
      persistAlwaysAllowed: async () => {},
      withSuspendedTimeout: async (_, wait) => wait(),
      emit: async (event) => {
        if (event.type === 'computer.app-approval.resolved') throw new Error('publication failed')
      }
    })
    const waiting = broker.authorize(context, { app: 'Notes' })
    const rejected = expect(waiting).rejects.toThrow('publication failed')
    await settle()
    await expect(
      broker.decide('task', broker.getPending('task')[0]!.requestId, 'session')
    ).rejects.toThrow('publication failed')
    await rejected
    expect(broker.getPending('task')).toEqual([])
    const next = broker.authorize(context, { app: 'Notes' })
    const cancelled = expect(next).rejects.toThrow('CANCELLED')
    await settle()
    expect(broker.getPending('task')).toHaveLength(1)
    await broker.cancelTask('task')
    await cancelled
  })
  it('rejects always for an application that disallows persistence without consuming the request', async () => {
    const h = harness({ ...policy, allowPersistentApproval: false })
    const waiting = h.broker.authorize(context, { app: 'Notes' })
    await settle()
    const id = h.requested[0]!.requestId
    await expect(h.broker.decide('task', id, 'always')).rejects.toThrow('INVALID_REQUEST')
    await h.broker.decide('task', id, 'once')
    await waiting
    expect(h.persisted.size).toBe(0)
  })
  it('session end removes authorization and cancels its pending requests', async () => {
    const h = harness()
    const first = h.broker.authorize(context, { app: 'Notes' })
    await settle()
    await h.broker.decide('task', h.requested[0]!.requestId, 'session')
    await first
    h.broker.endSession('session')
    const second = h.broker.authorize(context, { app: 'Notes' })
    const rejected = expect(second).rejects.toThrow('CANCELLED')
    await settle()
    h.broker.endSession('session')
    await rejected
    expect(h.requested).toHaveLength(2)
    expect(h.broker.getPending('task')).toHaveLength(0)
  })
  it('denial never grants session access', async () => {
    const h = harness()
    const waiting = h.broker.authorize(context, { app: 'Notes' })
    const denied = expect(waiting).rejects.toThrow('APP_NOT_APPROVED')
    await settle()
    await h.broker.decide('task', h.requested[0]!.requestId, 'deny')
    await denied
    expect(h.broker.getPending('task')).toHaveLength(0)
    expect(h.persisted.size).toBe(0)
  })
})
