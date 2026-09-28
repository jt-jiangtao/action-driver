// @vitest-environment node
import { test, expect, vi } from 'vitest'
import { BrowserPreferences } from '../src/service-preferences'
import { guardianOriginCache } from '../src/service-guardian-cache'
import { originalDocumentation } from './original-service'
function fixture(Type: any, global: any = {}, session: any = {}, requirement: any = {}) {
  const calls: any[] = [],
    store = (data: any) => ({
      get: async (name: string) => data[name],
      readSnapshot: async (options: any) => {
        calls.push(['snapshot', options])
        return { ...data }
      },
      set: async (name: string, value: any) => {
        data[name] = value
        calls.push(['set', name, value])
      },
      update: async (change: any) => {
        Object.assign(data, change(data))
        calls.push('update')
      }
    }),
    config = {
      global: store(global),
      session: (id: string) => {
        calls.push(['session', id])
        return store(session)
      },
      readRequirements: async () => ({ requirements: { browserUse: requirement } }),
      readAll: async () => ({ config: {} })
    },
    host = {
      env: {},
      requestMeta: { 'x-codex-turn-metadata': { session_id: 'session', turn_id: 'turn' } }
    }
  return { prefs: new Type(config, host), global, session, calls, host }
}
async function compare(exercise: (Type: any) => Promise<unknown>) {
  const base = await originalDocumentation()
  base.baselineGuardianCache.clear()
  guardianOriginCache.clear()
  expect(await exercise(BrowserPreferences)).toEqual(await exercise(base.BaselinePreferences))
}
test('origin request context preserves metadata fallback and subagent guardian identity rules', async () => {
  await compare(async (Type) => {
    const f = fixture(Type),
      results = []
    for (const metadata of [
      {},
      {
        conversationId: 'session',
        turnId: 'turn',
        threadId: 'thread',
        nodeReplAutoReviewRequired: true
      },
      {
        'x-codex-turn-metadata': JSON.stringify({
          session_id: 'root',
          thread_id: 'child',
          thread_source: 'subagent',
          turn_id: 'turn',
          node_repl_auto_review_required: true
        })
      },
      {
        'x-codex-turn-metadata': {
          session_id: 'session',
          turn_id: 'turn',
          node_repl_auto_review_required: true
        }
      }
    ]) {
      f.host.requestMeta = metadata as any
      results.push(f.prefs.captureOriginRequestContext('https://example.com/path'))
    }
    return results
  })
})
test('saved deny/approve priorities match original for conversation and global settings', async () => {
  await compare(async (Type) => {
    const results = []
    for (const global of [
      {},
      { approval_mode: 'never_ask' },
      { origins: { allowed: ['*.example.com'] } },
      { origins: { denied: ['https://example.com'] } }
    ])
      for (const session of [
        {},
        { origins: { allowed: ['https://example.com'] } },
        { origins: { denied: ['example.com'] } }
      ]) {
        const f = fixture(Type, global, session)
        results.push(await f.prefs.getOriginPermission('https://example.com'))
      }
    return results
  })
})
test('user prompt persists scoped permissions while preserving unrelated state and replacing opposite decisions', async () => {
  await compare(async (Type) => {
    const f = fixture(
        Type,
        {
          unrelated: 1,
          origins: { allowed: ['https://example.com'], denied: ['https://other.com'] }
        },
        { unrelated: 2 }
      ),
      results = []
    await f.prefs.handleOriginPromptResult('https://example.com', {
      action: 'decline',
      _meta: { persist: 'always' }
    })
    results.push(await f.prefs.getOriginPermission('https://example.com'))
    await f.prefs.handleOriginPromptResult('https://example.com', {
      action: 'accept',
      _meta: { persist: 'session' }
    })
    results.push(await f.prefs.getOriginPermission('https://example.com'))
    await f.prefs.handleFileTransferPromptResult('download', 'https://example.com', {
      action: 'accept',
      _meta: { persist: 'always' }
    })
    results.push(await f.prefs.getFileTransferPermission('download', 'https://example.com'))
    return { global: f.global, session: f.session, results, calls: f.calls }
  })
})
test('automatic approvals expire and do not persist; user cancellation does not grant access', async () => {
  vi.useFakeTimers()
  try {
    await compare(async (Type) => {
      vi.setSystemTime(0)
      const f = fixture(Type),
        result = []
      await f.prefs.handleOriginPromptResult('https://example.com', {
        action: 'accept',
        _meta: { approvals_reviewer: 'auto_review' }
      })
      result.push(await f.prefs.getOriginPermission('https://example.com'))
      vi.setSystemTime(300000)
      result.push(await f.prefs.getOriginPermission('https://example.com'))
      await f.prefs.handleOriginPromptResult('https://example.com', {
        action: 'cancel',
        _meta: { persist: 'always' }
      })
      result.push(await f.prefs.getOriginPermission('https://example.com'))
      return { result, global: f.global, session: f.session }
    })
  } finally {
    vi.useRealTimers()
  }
})
test('enterprise turn-only lifetime makes conversation approval expire across turns', async () => {
  await compare(async (Type) => {
    const f = fixture(Type, {}, {}, { defaultOriginPolicy: { accessApprovalLifetime: 'turn' } }),
      results = []
    await f.prefs.handleOriginPromptResult('https://example.com', {
      action: 'accept',
      _meta: { persist: 'session' }
    })
    results.push(await f.prefs.getOriginPermission('https://example.com'))
    f.host.requestMeta['x-codex-turn-metadata'].turn_id = 'next'
    results.push(await f.prefs.getOriginPermission('https://example.com'))
    return { results, session: f.session }
  })
})
test('full CDP and history saved approvals respect their own tables and origin denial', async () => {
  await compare(async (Type) => {
    const f = fixture(Type),
      results = []
    await f.prefs.handleFullCdpPromptResult('https://example.com', {
      action: 'accept',
      content: { persist: 'session' }
    })
    results.push(await f.prefs.getFullCdpPermission('https://example.com'))
    await f.prefs.handleHistoryPromptResult(
      { action: 'accept', _meta: { persist: 'always' } },
      'iab'
    )
    results.push(await f.prefs.getHistoryPermission('iab'))
    return { results, session: f.session, global: f.global, calls: f.calls }
  })
})
test('guardian v2 uses fresh snapshots, honors revocation and fails closed for required unavailable saved state', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any, cache: any) {
    cache.clear()
    const f = fixture(Type),
      metadata = f.host.requestMeta['x-codex-turn-metadata'] as any
    metadata.node_repl_auto_review_required = true
    metadata.thread_id = 'v2-thread'
    const origin = 'https://v2.example.com',
      context = f.prefs.captureOriginRequestContext(origin)
    await f.prefs.handleOriginPromptResult(
      origin,
      { action: 'accept', _meta: { approvals_reviewer: 'auto_review' } },
      context
    )
    const approved = await f.prefs.getOriginPermission(origin)
    cache.revoke(context.guardianOrigin)
    const revoked = await f.prefs.getOriginPermission(origin)
    delete f.prefs.config.global.readSnapshot
    const unavailable = await f.prefs.getOriginPermission(origin, context, {
      requireSavedPermissions: true
    })
    cache.clear()
    return { approved, revoked, unavailable, calls: f.calls }
  }
  expect(await exercise(BrowserPreferences, guardianOriginCache)).toEqual(
    await exercise(base.BaselinePreferences, base.baselineGuardianCache)
  )
})
test('persisted literal wildcard origin is escaped and does not authorize other sites', async () => {
  await compare(async (Type) => {
    const f = fixture(Type),
      origin = 'https://literal*.example.com'
    await f.prefs.handleOriginPromptResult(origin, {
      action: 'accept',
      _meta: { persist: 'always' }
    })
    return {
      global: f.global,
      exact: await f.prefs.getOriginPermission(origin),
      other: await f.prefs.getOriginPermission('https://literalX.example.com')
    }
  })
})
test('global persistence enterprise limit downgrades origin approval and ignores file transfer global grants', async () => {
  await compare(async (Type) => {
    const f = fixture(Type, {}, {}, { defaultOriginPolicy: { persistentApproval: false } })
    await f.prefs.handleOriginPromptResult('https://limited.example.com', {
      action: 'accept',
      _meta: { persist: 'always' }
    })
    await f.prefs.handleFileTransferPromptResult('upload', 'https://limited.example.com', {
      action: 'accept',
      _meta: { persist: 'always' }
    })
    return {
      global: f.global,
      session: f.session,
      origin: await f.prefs.getOriginPermission('https://limited.example.com'),
      upload: await f.prefs.getFileTransferPermission('upload', 'https://limited.example.com')
    }
  })
})
test('concurrent origin approvals share automatic review and retry revoked approval safely', async () => {
  const base = await originalDocumentation(),
    { approveOrigin } = await import('../src/service-approval-gates')
  for (const mode of ['approve', 'decline', 'cancel', 'revoke']) {
    async function exercise(Type: any, run: any, cache: any) {
      cache.clear()
      const f = fixture(Type)
      ;(f.host.requestMeta['x-codex-turn-metadata'] as any).node_repl_auto_review_required = true
      const origin = 'https://concurrent.example.com'
      let prompts = 0
      const get = () => async () => {
        prompts++
        await Promise.resolve()
        if (mode === 'revoke' && prompts === 1)
          cache.revoke(f.prefs.captureOriginRequestContext(origin).guardianOrigin)
        return {
          action: mode === 'decline' ? 'decline' : mode === 'cancel' ? 'cancel' : 'accept',
          _meta: { approvals_reviewer: 'auto_review' }
        }
      }
      const results = await Promise.all([
        run(get, origin, f.prefs).then(
          () => 'ok',
          (e: any) => e.reason
        ),
        run(get, origin, f.prefs).then(
          () => 'ok',
          (e: any) => e.reason
        )
      ])
      cache.clear()
      return { prompts, results }
    }
    expect(await exercise(BrowserPreferences, approveOrigin, guardianOriginCache)).toEqual(
      await exercise(
        base.BaselinePreferences,
        base.baselineOriginApproval,
        base.baselineGuardianCache
      )
    )
  }
})

test('unknown permission resources never inherit upload approval', async () => {
  await compare(async (Type) => {
    const f = fixture(Type, { uploads: { allowed: ['https://example.com'] } })
    const request = {
      resource: { kind: 'unknown', origin: 'https://example.com' },
      preferenceSessionId: 'session'
    }
    const decision = await f.prefs.maybeAutoAnswerBrowserUseRequest(request)
    return { decision, global: f.global, calls: f.calls }
  })
})

test('malformed reviewer metadata cannot create an automatic turn approval', async () => {
  await compare(async (Type) => {
    const f = fixture(Type)
    await f.prefs.handleOriginPromptResult('https://example.com', {
      action: 'accept',
      _meta: { approvals_reviewer: ['auto_review'] }
    })
    return await f.prefs.getOriginPermission('https://example.com')
  })
})
