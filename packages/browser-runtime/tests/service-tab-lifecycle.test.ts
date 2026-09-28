// @vitest-environment node
import { test, expect } from 'vitest'
import { TabLifecycle } from '../src/service-tab-lifecycle'
import { originalDocumentation } from './original-service'
test('created/acquired tabs track ownership, deduplicate events and reclaim per turn', async () => {
  const base = await originalDocumentation()
  function exercise(Type: any) {
    let session = 'first',
      turn: string | undefined = 'turn1'
    const lifecycle = new Type({
        getCurrentSessionId: () => session,
        getCurrentTurnId: () => turn
      }),
      results: any[] = []
    lifecycle.recordCreated(1)
    lifecycle.recordAcquired(2)
    lifecycle.recordAcquired(2, 'agent')
    results.push(lifecycle.takeEvents(), lifecycle.takeEvents(), lifecycle.needsReclaim(1))
    turn = 'turn2'
    results.push(lifecycle.needsReclaim(1), lifecycle.needsReclaim(99))
    lifecycle.recordAcquired(1)
    results.push(lifecycle.needsReclaim(1), lifecycle.takeEvents())
    session = 'second'
    results.push(lifecycle.needsReclaim(1))
    lifecycle.recordAcquired(1, 'external')
    results.push(lifecycle.takeEvents())
    turn = undefined
    results.push(lifecycle.needsReclaim(1))
    session = 'first'
    turn = 'turn3'
    results.push(lifecycle.needsReclaim(1), lifecycle.needsReclaim(2))
    return results
  }
  expect(exercise(TabLifecycle)).toEqual(exercise(base.BaselineTabLifecycle))
})
test('creation overrides earlier external ownership and records every creation event', async () => {
  const base = await originalDocumentation()
  function exercise(Type: any) {
    const lifecycle = new Type({
      getCurrentSessionId: () => undefined,
      getCurrentTurnId: () => undefined
    })
    lifecycle.recordAcquired(1)
    lifecycle.recordCreated(1)
    lifecycle.recordCreated(1)
    return {
      events: lifecycle.takeEvents(),
      reclaim: lifecycle.needsReclaim(1),
      sessions: [...lifecycle.sessions].map(([key, value]: any) => [
        key,
        [...value.acquiredTabs],
        [...value.claimedTurnIds]
      ])
    }
  }
  expect(exercise(TabLifecycle)).toEqual(exercise(base.BaselineTabLifecycle))
})
