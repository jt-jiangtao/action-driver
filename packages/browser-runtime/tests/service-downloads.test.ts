// @vitest-environment node
import { test, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { Downloads } from '../src/service-downloads'
import { originalDocumentation } from './original-service'
function fixture(Type: any, backend = 'iab', deny = false) {
  const calls: any[] = [],
    listeners = new Map<string, any>(),
    responses: any = new EventEmitter(),
    api = {
      addEventListener: (name: string, run: any) => listeners.set(name, run),
      matchesCurrentSessionId: (id: string) => id === 'session',
      allowDownload: async (params: any) => calls.push(['allow', params])
    }
  let interceptor: any
  responses.addRequestInterceptor = async (id: any, run: any) => {
    interceptor = run
    calls.push(['interceptor', id])
    return async () => calls.push('remove interceptor')
  }
  responses.continueResponse = async (...args: any[]) => {
    calls.push(['continue', ...args])
    listeners.get('onDownloadChange')({
      id: 'download',
      url: 'https://example.com/file',
      status: 'started',
      filename: '/tmp/file'
    })
    listeners.get('onDownloadChange')({
      id: 'download',
      url: 'https://example.com/file',
      status: 'complete',
      filename: '/tmp/file'
    })
  }
  responses.failResponse = async (...args: any[]) => calls.push(['fail', ...args])
  const security = {
      ensureDownloadAllowed: async (...args: any[]) => {
        calls.push(['security', ...args])
        if (deny) throw Error('denied')
      }
    },
    downloads = new Type(api, responses, security, backend)
  return {
    calls,
    responses,
    downloads,
    listeners,
    intercept: async (params: any) => interceptor(params)
  }
}
function response(mime = 'application/pdf', extra: any = {}) {
  return {
    requestId: 'request',
    resourceType: 'Document',
    frameId: 'main',
    request: { url: 'https://example.com/file' },
    responseStatusCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: mime }],
    ...extra
  }
}
test('download classification preserves MIME, redirects and content disposition intent rules', async () => {
  const base = await originalDocumentation()
  for (const mime of [
    'text/html',
    'application/pdf',
    'image/png',
    'video/mp4',
    'text/plain',
    'application/octet-stream'
  ])
    for (const explicit of [true, false])
      for (const extra of [
        {},
        {
          responseStatusCode: 302,
          responseHeaders: [{ name: 'Location', value: 'https://example.com' }]
        },
        { responseHeaders: [{ name: 'Content-Disposition', value: 'attachment; filename=file' }] }
      ]) {
        const original = fixture(base.BaselineDownloads),
          candidate = fixture(Downloads),
          input = response(mime, extra)
        expect(candidate.downloads.isDownload(input, explicit)).toBe(
          original.downloads.isDownload(input, explicit)
        )
      }
})
test('downloads require security approval, trusted backend allow and media response overrides', async () => {
  const base = await originalDocumentation()
  for (const backend of ['iab', 'cdp', 'extension'])
    for (const deny of [true, false]) {
      async function exercise(Type: any) {
        const f = fixture(Type, backend, deny)
        await f.downloads.enableDownload(1)
        await f.downloads.handleDownloadResponse(1, response(), true)
        let value, error
        try {
          value = await f.downloads.waitForDownload(1, 100)
        } catch (e: any) {
          error = e.message
        }
        return {
          value,
          error,
          calls: f.calls,
          path: f.downloads.getPath('download'),
          pending: f.downloads.pendingDownloadRequestsByTabId.size,
          intents: f.downloads.downloadIntents.size
        }
      }
      expect(await exercise(Downloads)).toEqual(await exercise(base.BaselineDownloads))
    }
})
test('media intent tracks exact initial URL, frame and redirect request lineage', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const f = fixture(Type),
      disable = await f.downloads.enableMediaDownload(1, 'https://example.com/file#hash', 'main')
    for (const request of [
      {
        requestId: 'other',
        resourceType: 'Document',
        frameId: 'child',
        request: { url: 'https://example.com/file' }
      },
      {
        requestId: 'first',
        resourceType: 'Document',
        frameId: 'main',
        request: { url: 'https://example.com/file' }
      },
      {
        requestId: 'redirect',
        redirectedRequestId: 'first',
        resourceType: 'Document',
        frameId: 'main',
        request: { url: 'https://cdn.example.com/file' }
      }
    ])
      await f.intercept(request)
    const ids = [...f.downloads.downloadIntents.get(1).requestIds]
    await disable()
    return { ids, calls: f.calls, intents: f.downloads.downloadIntents.size }
  }
  expect(await exercise(Downloads)).toEqual(await exercise(base.BaselineDownloads))
})
test('download changes ignore other sessions and timeout cleans waiting listeners', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const f = fixture(Type)
    f.listeners.get('onDownloadChange')({ session_id: 'other', id: 'ignored', filename: 'secret' })
    await f.downloads.enableDownload(1)
    let error
    try {
      await f.downloads.waitForDownload(1, 5)
    } catch (e: any) {
      error = e.message
    }
    return {
      error,
      path: f.downloads.getPath('ignored'),
      pending: f.downloads.pendingDownloadRequestsByTabId.size,
      intents: f.downloads.downloadIntents.size
    }
  }
  expect(await exercise(Downloads)).toEqual(await exercise(base.BaselineDownloads))
})
test('same-tab download concurrency rejects and releases active scope on errors', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const f = fixture(Type)
    let error
    try {
      await f.downloads.withDownload(1, () => f.downloads.withDownload(1, async () => {}))
    } catch (e: any) {
      error = e.message
    }
    return { error, active: f.downloads.activeDownloadTabs.size }
  }
  expect(await exercise(Downloads)).toEqual(await exercise(base.BaselineDownloads))
})
test('completed download tracking binds the initial URL/id and distinguishes failure/cancellation', async () => {
  const base = await originalDocumentation()
  for (const status of ['complete', 'failed', 'canceled']) {
    async function exercise(Type: any) {
      const f = fixture(Type)
      f.downloads.allowedDownloadUrlsByTabId.set(1, 'https://example.com/file')
      const wait = f.downloads.waitForCompletedDownload(1)
      for (const event of [
        {
          id: 'other',
          url: 'https://other.example/file',
          status: 'started',
          filename: '/tmp/other'
        },
        {
          id: 'download',
          url: 'https://example.com/file',
          status: 'started',
          filename: '/tmp/file'
        },
        {
          id: 'other',
          url: 'https://example.com/file',
          status: 'complete',
          filename: '/tmp/other'
        },
        { id: 'download', url: 'https://example.com/file', status, filename: '/tmp/file' }
      ])
        f.listeners.get('onDownloadChange')(event)
      let value, error
      try {
        value = await wait.promise
      } catch (e: any) {
        error = e.message
      }
      return { value, error }
    }
    expect(await exercise(Downloads)).toEqual(await exercise(base.BaselineDownloads))
  }
})
test('revoked paused response never continues after approval and media headers preserve parameters', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const f = fixture(Type)
    await f.downloads.enableDownload(1)
    await f.downloads.handleDownloadResponse(
      1,
      response('image/png', {
        responseHeaders: [
          { name: 'Content-Type', value: 'image/png' },
          { name: 'Content-Disposition', value: 'inline; filename="image.png"' }
        ]
      }),
      true
    )
    const request = f.downloads.pendingDownloadRequestsByTabId.get(1)
    f.downloads.security.ensureDownloadAllowed = async () => {
      await f.downloads.disableDownload(1)
    }
    let error
    try {
      await f.downloads.waitForDownload(1, 100)
    } catch (e: any) {
      error = e.message
    }
    return { request, error, calls: f.calls }
  }
  expect(await exercise(Downloads)).toEqual(await exercise(base.BaselineDownloads))
})
