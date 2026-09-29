// @vitest-environment node
import { test, expect } from 'vitest'
import { CdpAttachmentLifecycle } from '../../src/service-cdp-attachment'
import { originalDocumentation } from '../original-service'
async function fixture(original: boolean, failFocus?: string) {
  const base = await originalDocumentation(),
    calls: any[] = [],
    api = {
      addEventListener: () => () => {},
      attach: async (id: any) => calls.push(['attach', id]),
      detach: async (id: any) => calls.push(['detach', id]),
      executeCdp: async (params: any) => {
        calls.push(['cdp', params])
        if (failFocus) throw Error(failFocus)
      }
    },
    cdp = original
      ? new base.BaselineCdp(api, 'darwin', {
          withSpan: async (_n: any, _a: any, run: any) => run(),
          currentCommandAttrs: () => ({})
        })
      : new CdpAttachmentLifecycle(api)
  if (original) {
    cdp.tabAttachHandlers.clear()
    cdp.tabCleanupHandlers.clear()
  }
  cdp.on('tabAttached', (id: any) => calls.push(['attached', id]))
  cdp.on('tabDetached', (id: any) => calls.push(['detached', id]))
  return { cdp, calls, api }
}
test('CDP attachments coalesce and detach cleanup isolates handler errors', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original)
    f.cdp.addTabAttachHandler(async (id: any) => f.calls.push(['initialize', id]))
    f.cdp.addTabCleanupHandler(async (id: any) => {
      f.calls.push(['cleanup', id])
      throw Error('cleanup failed')
    })
    await Promise.all([f.cdp.ensureAttachedTab(1), f.cdp.ensureAttachedTab(1)])
    await f.cdp.ensureAttachedTab(1)
    await f.cdp.detachTab(1)
    await f.cdp.detachTab(1)
    return {
      calls: f.calls,
      attached: [...f.cdp.attachedTabIds],
      pending: f.cdp.tabAttachmentPromises.size
    }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('focus/initialization ignore ordinary failures and propagate timeouts with retry', async () => {
  for (const message of ['unsupported', 'timed out', 'deadline expired']) {
    async function exercise(original: boolean) {
      const f = await fixture(original, message)
      let error
      try {
        await f.cdp.ensureAttachedTab(1)
      } catch (e: any) {
        error = e.message
      }
      return {
        calls: f.calls,
        error,
        attached: [...f.cdp.attachedTabIds],
        pending: f.cdp.tabAttachmentPromises.size
      }
    }
    expect(await exercise(false)).toEqual(await exercise(true))
  }
})
test('detachment during initialization rejects attachment and clears state', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original)
    f.cdp.addTabAttachHandler(async (id: any) => f.cdp.forgetAttachedTab(id))
    let error
    try {
      await f.cdp.ensureAttachedTab(1)
    } catch (e: any) {
      error = typeof e === 'string' ? e : e.message
    }
    return {
      calls: f.calls,
      error,
      attached: [...f.cdp.attachedTabIds],
      pending: f.cdp.tabAttachmentPromises.size
    }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('all-tab detach tolerates transport failure and handler removal is effective', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original),
      remove = f.cdp.addTabAttachHandler(async () => {
        throw Error('timed out handler')
      })
    remove()
    await f.cdp.ensureAttachedTab(1)
    await f.cdp.ensureAttachedTab(2)
    f.api.detach = async (id: any) => {
      f.calls.push(['detach', id])
      throw Error('transport')
    }
    await f.cdp.detachAllTabs()
    return {
      calls: f.calls,
      attached: [...f.cdp.attachedTabIds],
      pending: f.cdp.tabAttachmentPromises.size
    }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
