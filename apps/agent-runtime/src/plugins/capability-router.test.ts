import { describe, expect, it } from 'vitest'
import { CapabilityRouter } from './capability-router'
const owner = { pluginId: 'source', version: '1.0.0', hostEpoch: 's' }
const target = { pluginId: 'target', version: '1.0.0', hostEpoch: 't' }
const context = { requestId: 'r', callId: 'c', taskId: 'task', deadline: 100, source: { kind: 'runtime' as const }, chain: [] }
describe('cross plugin capability routing', () => {
  it('derives context from the active invocation, propagates cancellation and checks target grants', async () => {
    const controller = new AbortController()
    let allowed = false
    const router = new CapabilityRouter({ now: () => 10, resolve: () => ({ id: 'target.read', owner: target }), authority: () => ({ context, signal: controller.signal }), authorize: async () => allowed,
      invoke: async (_id, input, derived, signal) => ({ input, task: derived.taskId!, source: { ...derived.source }, chain: derived.chain, cancelled: signal.aborted })
    })
    await expect(router.invoke(owner, 'target.read', null, 'c')).rejects.toThrow('AUTHORIZATION_DENIED')
    allowed = true; controller.abort()
    expect(await router.invoke(owner, 'target.read', { value: 1 }, 'c')).toEqual({ input: { value: 1 }, task: 'task', source: owner, chain: ['target.read'], cancelled: true })
  })
  it('rejects expired calls, cyclic routes and missing targets before execution', async () => {
    let current = { ...context, chain: ['target.read'] }
    const router = new CapabilityRouter({ now: () => 10, resolve: id => id === 'target.read' ? { id, owner: target } : undefined, authority: () => ({ context: current, signal: new AbortController().signal }), authorize: async () => true, invoke: async () => { throw new Error('should not execute') } })
    await expect(router.invoke(owner, 'target.read', null, 'c')).rejects.toThrow('DEPENDENCY_CYCLE')
    current = { ...context, chain: [], deadline: 5 }
    await expect(router.invoke(owner, 'target.read', null, 'c')).rejects.toThrow('DEADLINE_EXCEEDED')
    await expect(router.invoke(owner, 'missing', null, 'c')).rejects.toThrow('UNAVAILABLE')
  })
})
