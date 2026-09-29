// @vitest-environment node
import { test, expect, vi } from 'vitest'
import { GuardianOriginCache } from '../../src/service-guardian-cache'
import { originalDocumentation } from '../original-service'
const origin = { threadId: 'thread', origin: 'https://example.com' }
async function compare(exercise: (cache: any) => Promise<unknown>) {
  const base = await originalDocumentation()
  base.baselineGuardianCache.clear()
  const cache = new GuardianOriginCache()
  try {
    expect(await exercise(cache)).toEqual(await exercise(base.baselineGuardianCache))
  } finally {
    cache.clear()
    base.baselineGuardianCache.clear()
  }
}
test('guardian origin cache expires approvals, isolates threads and ignores revoked reviews', async () => {
  vi.useFakeTimers()
  try {
    await compare(async (cache) => {
      vi.setSystemTime(0)
      cache.record(origin)
      const first = cache.get(origin)
      cache.record({ ...origin, threadId: 'other' }, { revoked: true })
      const other = cache.get({ ...origin, threadId: 'other' })
      vi.setSystemTime(300000)
      const expired = cache.get(origin)
      return { first, other, expired }
    })
  } finally {
    vi.useRealTimers()
  }
})
test('guardian reviews coalesce pending decisions and newer approvals force retry', async () => {
  await compare(async (cache) => {
    let resolve!: (value: string) => void,
      calls = 0
    const input = new Promise<string>((yes) => (resolve = yes)),
      first = cache.start(origin, undefined, async () => {
        calls++
        return input
      }),
      shared = cache.start(origin, undefined, async () => {
        calls++
        return 'wrong'
      })
    expect(first.decision).toBe(shared.decision)
    resolve('approved')
    const result = await first.decision
    cache.record(origin)
    const approval = cache.get(origin),
      retry = cache.start(origin, undefined, () => 'wrong'),
      next = cache.start(origin, approval, () => 'same')
    const done = await next.decision
    return {
      calls,
      firstKind: first.kind,
      firstShared: first.shared,
      shared: shared.shared,
      result,
      retry,
      done: done.result,
      approvalPresent: done.approval === approval
    }
  })
})
test('guardian revocation mutates pending review token and prevents recording stale approval', async () => {
  await compare(async (cache) => {
    let resolve!: (value: string) => void, review: any
    const input = new Promise<string>((yes) => (resolve = yes)),
      pending = cache.start(origin, undefined, async (token: any) => {
        review = token
        return input
      })
    await Promise.resolve()
    cache.revoke(origin)
    cache.record(origin, review)
    resolve('done')
    const result = await pending.decision
    return { revoked: review.revoked, result, approval: cache.get(origin) }
  })
})
test('failed guardian review can be retried and cache clear cancels approval state', async () => {
  await compare(async (cache) => {
    const error = Error('review'),
      first = cache.start(origin, undefined, () => {
        throw error
      })
    await expect(first.decision).rejects.toBe(error)
    const second = cache.start(origin, undefined, () => 'done')
    const result = await second.decision
    cache.record(origin)
    cache.clear()
    return { result, shared: second.shared, approval: cache.get(origin) }
  })
})
