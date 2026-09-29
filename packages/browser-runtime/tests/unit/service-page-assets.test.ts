// @vitest-environment node
import { test, expect } from 'vitest'
import { PageAssets } from '../../src/service-page-assets'
import { originalDocumentation } from '../original-service'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const page = 'https://example.com/page',
  asset = {
    id: 'image',
    kind: 'image',
    name: 'image.png',
    sources: [],
    url: 'https://cdn.example.com/image.png'
  }
async function fixture(Type: any, mode = 'loaded') {
  const tmpDir = await mkdtemp(join(tmpdir(), 'asset-parity-')),
    calls: any[] = [],
    cdp = {
      call: async (_id: any, method: any) => {
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } }
        if (method === 'Page.getResourceContent') {
          if (mode !== 'loaded' && mode !== 'mismatch') throw Error('unavailable')
          return { base64Encoded: true, content: 'AQID' }
        }
        if (method === 'Page.getResourceTree')
          return {
            frameTree: {
              resources: [
                { url: asset.url, mimeType: mode === 'mismatch' ? 'text/html' : 'image/png' }
              ]
            }
          }
        return {}
      },
      evaluateJavascript: async () => ({ base64: 'AQID', contentType: 'image/png' })
    },
    security = {
      ensurePageAssetDownloadAllowed: async (url: any) => calls.push(['download', url]),
      ensurePageAssetFallbackFetchAllowed: async (...args: any[]) => {
        calls.push(['fallback', ...args])
        if (mode === 'denied') throw Error('denied')
      }
    },
    state = new Type(
      cdp,
      security,
      { env: {} },
      { tmpDir, mkdir, writeFile, rm },
      { type: 'iab', family: 'chrome' }
    )
  return { state, tmpDir, calls }
}
function clean(value: any): any {
  if (Array.isArray(value)) return value.map(clean)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, value]) => [
        key,
        key === 'elapsedMs' ? 'measured' : clean(value)
      ])
    )
  if (typeof value === 'string')
    return value.replace(/\/[^ ]*asset-parity-[^/]+\/browser-use\/assets\/[^/]+/g, 'DIRECTORY')
  return value
}
test('inventory binding filters kinds/ids and rejects unknown or stale requests', async () => {
  const base = await originalDocumentation()
  for (const options of [
    {},
    { assetIds: ['missing'] },
    { assetIds: ['image'], kinds: ['font'] },
    { documentUrl: 'https://changed.example' }
  ]) {
    async function exercise(Type: any) {
      const f = await fixture(Type)
      try {
        const id = f.state.createInventory({
            assets: [asset, { ...asset, id: 'script', kind: 'script' }],
            inlineSvgs: [],
            documentUrl: page,
            tabId: 1
          }),
          request = { inventoryId: id, documentUrl: page, tabId: 1, ...options }
        const selected = f.state.getAssets(request)
        let error
        try {
          await f.state.bundle(request)
        } catch (e: any) {
          error = e.message
        }
        return { selected: clean(selected), error }
      } finally {
        await rm(f.tmpDir, { recursive: true, force: true })
      }
    }
    expect(await exercise(PageAssets)).toEqual(await exercise(base.BaselinePageAssets))
  }
})
test('asset bundle reads loaded resource or approved fallback and writes bytes plus manifest', async () => {
  const base = await originalDocumentation()
  for (const mode of ['loaded', 'fallback', 'mismatch', 'denied']) {
    async function exercise(Type: any) {
      const f = await fixture(Type, mode)
      try {
        const id = f.state.createInventory({
          assets: [asset],
          inlineSvgs: [{ id: 'svg', name: 'Icon', markup: '<svg/>' }],
          documentUrl: page,
          tabId: 1
        })
        let result, error, bytes
        try {
          result = await f.state.bundle({ inventoryId: id, documentUrl: page, tabId: 1 })
          if (result.assets.some((a: any) => a.id === 'image'))
            bytes = [...(await readFile(result.assets.find((a: any) => a.id === 'image').path))]
          if (result.assets.some((a: any) => a.id === 'svg'))
            expect(
              await readFile(result.assets.find((a: any) => a.id === 'svg').path, 'utf8')
            ).toBe('<svg/>')
          if (result)
            expect(clean(JSON.parse(await readFile(result.manifestPath, 'utf8')))).toEqual(
              clean({ assets: result.assets, failures: result.failures })
            )
        } catch (e: any) {
          error = e.message
        }
        return { result: clean(result), error, bytes, calls: f.calls }
      } finally {
        await rm(f.tmpDir, { recursive: true, force: true })
      }
    }
    expect(await exercise(PageAssets)).toEqual(await exercise(base.BaselinePageAssets))
  }
})
test('fallback approvals share origin, serialize across origins and discard failed bundles', async () => {
  const base = await originalDocumentation()
  for (const deny of [true, false]) {
    async function exercise(Type: any) {
      const f = await fixture(Type, 'fallback')
      try {
        f.state.security.ensurePageAssetFallbackFetchAllowed = async (_page: any, url: any) => {
          f.calls.push(['fallback', url])
          await Promise.resolve()
          if (deny && url.includes('other.example')) throw Error('denied')
        }
        const assets = [
            asset,
            { ...asset, id: 'second', url: 'https://cdn.example.com/second.png' },
            { ...asset, id: 'third', url: 'https://other.example/third.png' }
          ],
          id = f.state.createInventory({ assets, inlineSvgs: [], documentUrl: page, tabId: 1 })
        let result, error
        try {
          result = await f.state.bundle({ inventoryId: id, documentUrl: page, tabId: 1 })
        } catch (e: any) {
          error = e.message
        }
        const { readdir } = await import('node:fs/promises')
        return {
          result: clean(result),
          error,
          calls: f.calls,
          directories: await readdir(join(f.tmpDir, 'browser-use/assets'))
        }
      } finally {
        await rm(f.tmpDir, { recursive: true, force: true })
      }
    }
    const candidate = await exercise(PageAssets),
      original = await exercise(base.BaselinePageAssets)
    if (!deny) {
      candidate.directories = candidate.directories.map(() => 'bundle')
      original.directories = original.directories.map(() => 'bundle')
    }
    expect(candidate).toEqual(original)
  }
})
