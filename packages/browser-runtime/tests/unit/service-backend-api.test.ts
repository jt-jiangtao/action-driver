// @vitest-environment node
import { test, expect } from 'vitest'
import { SessionBrowserApi } from '../../src/service-backend-api'
import { originalDocumentation } from '../original-service'
async function compare(exercise: (Api: any) => Promise<unknown>) {
  const base = await originalDocumentation()
  expect(await exercise(SessionBrowserApi)).toEqual(await exercise(base.BaselineBackendApi))
}
function fixture(Api: any, options: any = {}) {
  let incoming: any,
    metadata: any = { session_id: 's', turn_id: 't' },
    count = 0
  const requests: any[] = [],
    tracked: any[] = [],
    notifications: any[] = []
  const transport = {
    setMessageCallback: (cb: any) => (incoming = cb),
    addCloseListener: () => () => {},
    close: async () => {},
    sendMessage: (message: any) => {
      if (message.id === undefined) {
        notifications.push(message)
        return
      }
      requests.push(message)
      const result = options.result?.(message, ++count) ?? {}
      queueMicrotask(() =>
        incoming(
          result instanceof Error
            ? { id: message.id, error: { message: result.message } }
            : { id: message.id, result }
        )
      )
    }
  }
  const api = new Api(
    transport,
    { ping: () => 'pong' },
    () => metadata,
    { track: (meta: any, callback: any) => tracked.push([meta, callback === api.turnEnded]) },
    options.header
  )
  return {
    api,
    requests,
    tracked,
    notifications,
    set metadata(value: any) {
      metadata = value
    },
    get metadata() {
      return metadata
    },
    incoming: () => incoming
  }
}
test('session requests carry live and cached metadata, subagent scope and track only known backends', async () => {
  await compare(async (Api) => {
    const f = fixture(Api)
    f.api.clientInfo = { type: 'extension', sessionTabForegroundEnabled: true }
    await f.api.getTabs()
    f.metadata = null
    await f.api.getUserTabs()
    f.metadata = {
      session_id: 'root',
      thread_source: 'subagent',
      thread_id: 'child',
      turn_id: 'next'
    }
    await f.api.createTab(8)
    await f.api.followSessionTab('tab', 'activity')
    f.api.sendWebMcpToolInvoked({ tabId: 'tab' })
    return {
      requests: f.requests,
      tracked: f.tracked,
      notifications: f.notifications,
      last: f.api.lastSessionParams,
      session: f.api.getCurrentSessionId(),
      turn: f.api.getCurrentTurnId(),
      matches: f.api.matchesCurrentSessionId('child')
    }
  })
})
test('session metadata errors and no foreground capability preserve original behavior', async () => {
  await compare(async (Api) => {
    const f = fixture(Api),
      errors: any[] = []
    for (const metadata of [null, {}, { session_id: 's' }]) {
      f.metadata = metadata
      try {
        await f.api.getTabs()
      } catch (e: any) {
        errors.push(e.message)
      }
    }
    f.metadata = null
    return {
      errors,
      follow: await f.api.followSessionTab('tab'),
      matches: f.api.matchesCurrentTurn({ session_id: 's', turn_id: 't' }),
      turn: f.api.getCurrentTurnId()
    }
  })
})
test('agent header enablement latches and stale extension support fails explicitly', async () => {
  await compare(async (Api) => {
    let enabled = false,
      calls = 0
    const f = fixture(Api, {
      header: async () => {
        calls++
        return enabled
      }
    })
    f.api.clientInfo = { type: 'extension', agentRequestHeaderEnabled: false }
    await f.api.getTabs()
    enabled = true
    await f.api.getTabs()
    enabled = false
    await f.api.getTabs()
    f.api.clientInfo.agentRequestHeaderEnabled = 'unsupported'
    let error
    try {
      await f.api.getTabs()
    } catch (e: any) {
      error = e.message
    }
    return { calls, error, requests: f.requests, last: f.api.lastSessionParams, tracked: f.tracked }
  })
})
test('cached CDP expression refill and unsupported-method fallback match original', async () => {
  await compare(async (Api) => {
    const f = fixture(Api, {
        result: (message: any, count: number) =>
          message.method === 'executeCdp'
            ? { fallback: true }
            : count === 2
              ? { kind: 'missing' }
              : { kind: 'executed', result: count }
      }),
      input = {
        target: { tabId: 'tab' },
        method: 'Runtime.evaluate',
        commandParams: { expression: 'code', other: 1 }
      }
    const first = await f.api.executeCdpWithCachedExpression(input, 'key'),
      second = await f.api.executeCdpWithCachedExpression(input, 'key')
    const unsupported = fixture(Api, {
      result: (message: any) =>
        message.method === 'executeCdpWithCachedExpression'
          ? Error('No handler registered for method: executeCdpWithCachedExpression')
          : { fallback: true }
    })
    await unsupported.api.executeCdpWithCachedExpression(input, 'key')
    await unsupported.api.executeCdpWithCachedExpression(input, 'key')
    return { first, second, requests: f.requests, fallback: unsupported.requests, input }
  })
})
test.each(['iab', 'cdp', 'extension'])('committed URL %s fallback is cached', async (type) => {
  await compare(async (Api) => {
    const f = fixture(Api, {
      result: (message: any) =>
        message.method === 'getCommittedTabUrl'
          ? Error('No handler registered for method: getCommittedTabUrl')
          : message.method === 'executeCdp'
            ? type === 'iab'
              ? { targetInfo: { url: 'https://example.com' } }
              : { frameTree: { frame: { url: 'https://example.com' } } }
            : [{ id: 'tab', url: 'https://example.com' }]
    })
    f.api.clientInfo = { type }
    const a = await f.api.getCommittedTabUrl('tab'),
      b = await f.api.getCommittedTabUrl('tab')
    return { a, b, requests: f.requests }
  })
})
test('turn cleanup always notifies backend and suppresses tracking while detaching same turn', async () => {
  await compare(async (Api) => {
    const f = fixture(Api)
    f.api.clientInfo = { type: 'iab' }
    await f.api.getTabs()
    f.api.detachTurn = async (current: any) => {
      expect(current()).toBe(true)
      await f.api.detach('tab')
      throw Error('detach')
    }
    let error
    try {
      await f.api.turnEnded({ session_id: 's', turn_id: 't' })
    } catch (e: any) {
      error = e.message
    }
    return { error, requests: f.requests, tracked: f.tracked, ending: f.api.endingTurnId }
  })
})
test('page events drain once and getInfo caches browser info', async () => {
  await compare(async (Api) => {
    const f = fixture(Api, { result: () => ({ type: 'iab' }) })
    await f.incoming()({ method: 'onPageEvent', params: { event: 1 } })
    await f.api.getInfo()
    return {
      first: f.api.takePageEvents(),
      second: f.api.takePageEvents(),
      info: f.api.clientInfo,
      requests: f.requests
    }
  })
})
