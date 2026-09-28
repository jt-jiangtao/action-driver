import { describe, expect, it, vi } from 'vitest'
import { AppApprovalBroker } from './app-approval-broker'
import { ApplicationLeases } from './application-leases'
import { createOwnedSkySession } from './owned-sky-session'

const policy = {
  decision: 'allowed' as const,
  allowPersistentApproval: true,
  target: {
    bundleId: 'com.apple.Notes', displayName: 'Notes',
    appPath: '/System/Applications/Notes.app', risk: 'low' as const
  }
}
const request = (operation: string, extra: Record<string, unknown> = {}) => ({
  version: 1, requestId: 'req', deadlineUnixMs: Date.now() + 1000, operation, ...extra
})

describe('owned Computer Use host gate', () => {
  it('authorizes app access, canonicalizes session and app, and preserves the lease', async () => {
    const invoke = vi.fn(async (input: Record<string, unknown>) => {
      if (input.operation === 'app-policy') return policy
      return { app: input.app, text: '[1] Notes', screenshot: null }
    })
    const broker = new AppApprovalBroker({
      queryPolicy: async () => policy, isAlwaysAllowed: async () => true,
      persistAlwaysAllowed: async () => {}, emit: () => {},
      withSuspendedTimeout: async (_task, wait) => wait()
    })
    const leases = new ApplicationLeases()
    const sky = createOwnedSkySession({ broker, leases, assertRunning: () => {}, invoke })
    const context = { taskId: 'task', sessionId: 'trusted-session' }
    await sky.invoke(request('app-state', {
      sessionId: 'forged', app: 'Notes', maxElements: 300, maxDepth: 12
    }), context)
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'app-state', sessionId: 'trusted-session', app: policy.target.appPath
    }), undefined)
    await expect(sky.invoke(request('app-policy', { app: 'Notes' }), context)).rejects.toThrow('unsupported')
    await expect(sky.invoke(request('act', {
      sessionId: 'other', app: 'Notes', action: { type: 'type', text: 'hi' }
    }), { taskId: 'other-task', sessionId: 'other-session' })).rejects.toThrow('APP_BUSY')
    sky.releaseTurn('task')
    await expect(sky.invoke(request('act', {
      sessionId: 'other', app: 'Notes', action: { type: 'type', text: 'hi' }
    }), { taskId: 'other-task', sessionId: 'other-session' })).resolves.toBeDefined()
  })

  it('never reaches the helper after denial', async () => {
    const denied = { ...policy, decision: 'forbidden' as const }
    const invoke = vi.fn(async () => ({}))
    const sky = createOwnedSkySession({
      broker: new AppApprovalBroker({
        queryPolicy: async () => denied, isAlwaysAllowed: async () => false,
        persistAlwaysAllowed: async () => {}, emit: () => {},
        withSuspendedTimeout: async (_task, wait) => wait()
      }), leases: new ApplicationLeases(), assertRunning: () => {}, invoke
    })
    await expect(sky.invoke(request('app-state', {
      sessionId: 'session', app: 'Notes', maxElements: 300, maxDepth: 12
    }), { taskId: 'task', sessionId: 'session' })).rejects.toThrow('APP_FORBIDDEN')
    expect(invoke).not.toHaveBeenCalled()
  })
})
