import { discoverPageAssets, discoverInlineSvgs, assetKind } from './service-asset-discovery.js'
import type { AssetCdp, AssetKind, PageAsset, InlineSvg } from './service-asset-discovery.js'
import { pageOrigin } from './service-approval-gates.js'
interface AssetFilesystem {
  tmpDir: string
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
  writeFile(path: string, value: string | Uint8Array): Promise<unknown>
  rm(path: string, options: { force: true; recursive: true }): Promise<unknown>
}
interface AssetSecurity {
  ensurePageAssetDownloadAllowed(url: string | undefined): Promise<unknown>
  ensurePageAssetFallbackFetchAllowed(
    pageUrl: string | undefined,
    assetUrl: string
  ): Promise<unknown>
}
type InventoryAsset =
  | { source: 'page-asset'; asset: PageAsset }
  | { source: 'inline-svg'; asset: InlineSvg }
interface Inventory {
  assetsById: Map<string, InventoryAsset>
  documentUrl: string | undefined
  tabId: number
}
interface BundleRequest {
  assetIds?: string[]
  documentUrl?: string
  inventoryId: string
  kinds?: AssetKind[]
  tabId: number
}
interface SavedAsset {
  contentType: string | null
  id: string
  kind: AssetKind
  name: string
  path: string
  url: string
}
interface FailedAsset {
  contentType: string | null
  id: string
  name: string
  reason: string
  url: string
}
interface AssetData {
  base64: string
  contentType: string | null
}
const supported = (asset: InventoryAsset) =>
  asset.source === 'inline-svg' ||
  ['font', 'image', 'stylesheet', 'video'].includes(asset.asset.kind)
const assetUrl = (asset: InventoryAsset) =>
  asset.source === 'inline-svg' ? `inline-svg:${asset.asset.id}` : asset.asset.url
function normalizedMime(input: string | null) {
  const mime = input?.split(';', 1)[0]?.trim().toLowerCase()
  return mime ? (/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime) ? mime : 'invalid') : null
}
function validMime(kind: AssetKind, mime: string | null) {
  if (mime === null) return kind === 'stylesheet'
  switch (kind) {
    case 'font':
      return (
        mime.startsWith('font/') ||
        [
          'application/font-woff',
          'application/font-woff2',
          'application/vnd.ms-fontobject',
          'application/x-font-opentype',
          'application/x-font-ttf'
        ].includes(mime)
      )
    case 'image':
      return mime.startsWith('image/')
    case 'stylesheet':
      return mime === 'text/css'
    case 'video':
      return mime.startsWith('video/')
    default:
      return false
  }
}
function extension(input: string) {
  let path: string
  try {
    path = new URL(input).pathname
  } catch {
    path = input.split(/[?#]/, 1)[0] ?? input
  }
  const name = path.split('/').pop() ?? '',
    at = name.lastIndexOf('.')
  return at > 0 ? name.slice(at) : ''
}
function mimeForResource(tree: any, url: string): string | null {
  if (tree == null) return null
  const mime = tree.resources?.find((resource: any) => resource.url === url)?.mimeType
  if (mime != null) return mime
  for (const child of tree.childFrames ?? []) {
    const found = mimeForResource(child, url)
    if (found != null) return found
  }
  return null
}
/** Self-contained page fetch, used only after explicit fallback permission. */
async function fetchPageAsset({ url }: { url: string }) {
  const response = await fetch(url, { credentials: 'include', method: 'GET' })
  if (!response.ok) throw Error(`Asset request failed with HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  let text = ''
  for (let offset = 0; offset < bytes.length; offset += 32768)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  return { base64: btoa(text), contentType: response.headers.get('content-type') }
}
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Asset bundling failed'
export class PageAssets {
  inventoriesById = new Map<string, Inventory>()
  reportFailure:
    | ((
        runtime: unknown,
        kind: AssetKind,
        contentType: string | null,
        type: string,
        clientInfo: unknown
      ) => unknown)
    | undefined
  constructor(
    private cdp: AssetCdp,
    private security: AssetSecurity,
    private runtime: unknown,
    private filesystem: AssetFilesystem,
    private clientInfo: unknown
  ) {}
  async list({ documentUrl, tabId }: { documentUrl?: string; tabId: number }) {
    const [assets, inlineSvgs] = await Promise.all([
        discoverPageAssets({ cdp: this.cdp, tabId }),
        discoverInlineSvgs({ cdp: this.cdp, tabId })
      ]),
      id = this.createInventory({ assets, inlineSvgs, documentUrl, tabId }),
      byKind: Record<AssetKind, number> = {
        font: 0,
        image: 0,
        other: 0,
        script: 0,
        stylesheet: 0,
        video: 0
      }
    for (const asset of assets) byKind[asset.kind]++
    return {
      assets,
      id,
      inlineSvgs,
      pageUrl: documentUrl ?? null,
      summary: { byKind, inlineSvgCount: inlineSvgs.length, totalCount: assets.length }
    }
  }
  createInventory({
    assets,
    documentUrl,
    inlineSvgs,
    tabId
  }: {
    assets: PageAsset[]
    documentUrl: string | undefined
    inlineSvgs: InlineSvg[]
    tabId: number
  }) {
    const id = crypto.randomUUID(),
      assetsById = new Map<string, InventoryAsset>()
    for (const asset of assets) assetsById.set(asset.id, { source: 'page-asset', asset })
    for (const asset of inlineSvgs) assetsById.set(asset.id, { source: 'inline-svg', asset })
    this.inventoriesById.set(id, { assetsById, documentUrl, tabId })
    return id
  }
  getAssets({ assetIds, documentUrl, inventoryId, kinds, tabId }: BundleRequest) {
    const inventory = this.inventoriesById.get(inventoryId)
    if (
      inventory === undefined ||
      inventory.documentUrl !== documentUrl ||
      inventory.tabId !== tabId
    )
      return null
    return {
      assets: (assetIds == null
        ? [...inventory.assetsById.values()]
        : assetIds.flatMap((id) => {
            const asset = inventory.assetsById.get(id)
            return asset === undefined ? [] : [asset]
          })
      ).filter(
        (asset) =>
          kinds == null ||
          kinds.includes(asset.source === 'inline-svg' ? 'image' : asset.asset.kind)
      ),
      missingAssetIds: assetIds?.filter((id) => !inventory.assetsById.has(id)) ?? []
    }
  }
  async bundle(request: BundleRequest) {
    const started = performance.now(),
      selection = this.getAssets(request)
    if (selection === null) throw Error('Asset inventory is no longer valid for this page')
    if (selection.missingAssetIds.length > 0)
      throw Error('Asset bundle request included unknown asset ids')
    if (request.assetIds != null && selection.assets.some((asset) => !supported(asset)))
      throw Error('Asset bundle request included unsupported asset kinds')
    const selected = selection.assets.filter(supported)
    if (selected.length === 0) throw Error('Asset bundle request matched no discovered assets')
    await this.security.ensurePageAssetDownloadAllowed(request.documentUrl)
    const directoryPath = `${this.filesystem.tmpDir}/browser-use/assets/${crypto.randomUUID()}`
    await this.filesystem.mkdir(directoryPath, { recursive: true })
    const approvals = new Map<string, Promise<void>>()
    let failed: Error | undefined,
      tail = Promise.resolve()
    const fallback = (url: string) => {
      const origin = pageOrigin(url) ?? url,
        existing = approvals.get(origin)
      if (existing !== undefined) return existing
      const approval = tail.then(async () => {
        if (failed !== undefined) throw failed
        try {
          await this.security.ensurePageAssetFallbackFetchAllowed(request.documentUrl, url)
        } catch (error) {
          failed =
            error instanceof Error ? error : Error('Page asset fallback download approval failed')
          throw failed
        }
      })
      approvals.set(origin, approval)
      tail = approval.catch(() => {})
      return approval
    }
    const result = await Promise.all(
      selected.map((asset) => this.saveAsset(asset, request.tabId, directoryPath, fallback))
    )
    if (failed !== undefined) {
      await this.filesystem.rm(directoryPath, { force: true, recursive: true })
      throw failed
    }
    const assets = result.flatMap((result) => (result.asset === undefined ? [] : [result.asset])),
      failures = result.flatMap((result) => (result.failure === undefined ? [] : [result.failure])),
      manifestPath = `${directoryPath}/manifest.json`
    await this.filesystem.writeFile(manifestPath, JSON.stringify({ assets, failures }, null, 2))
    return {
      assets,
      directoryPath,
      failures,
      manifestPath,
      summary: {
        downloadedCount: assets.length,
        elapsedMs: performance.now() - started,
        failedCount: failures.length,
        requestedCount: selected.length
      }
    }
  }
  private async readAsset(
    tabId: number,
    url: string,
    fallback: (url: string) => Promise<void>
  ): Promise<AssetData> {
    const frame = (await this.cdp.call(tabId, 'Page.getFrameTree')) as {
      frameTree?: { frame?: { id?: string } }
    }
    let loadedError: unknown
    try {
      const id = frame.frameTree?.frame?.id
      if (id == null) throw Error('Unable to determine frame id')
      await this.cdp.call(tabId, 'Page.enable')
      const [raw, tree] = (await Promise.all([
        this.cdp.call(tabId, 'Page.getResourceContent', { frameId: id, url }),
        this.cdp.call(tabId, 'Page.getResourceTree')
      ])) as [{ base64Encoded?: boolean; content: string }, { frameTree: unknown }]
      return {
        base64:
          raw.base64Encoded === true
            ? raw.content
            : btoa(
                Array.from(new TextEncoder().encode(raw.content), (byte) =>
                  String.fromCharCode(byte)
                ).join('')
              ),
        contentType: mimeForResource(tree.frameTree, url)
      }
    } catch (error) {
      loadedError = error
    }
    await fallback(url)
    try {
      const value = await this.cdp.evaluateJavascript(
        tabId,
        `(${fetchPageAsset.toString()})(${JSON.stringify({ url })})`,
        { awaitPromise: true }
      )
      if (value == null) throw Error('Unable to bundle asset')
      return value as AssetData
    } catch (error) {
      throw Error(
        `Loaded resource fetch failed: ${errorMessage(loadedError)}; page fetch failed: ${errorMessage(error)}`,
        { cause: error }
      )
    }
  }
  private failure(asset: InventoryAsset, contentType: string | null, reason: string): FailedAsset {
    return { contentType, id: asset.asset.id, name: asset.asset.name, reason, url: assetUrl(asset) }
  }
  private async saveAsset(
    asset: InventoryAsset,
    tabId: number,
    directory: string,
    fallback: (url: string) => Promise<void>
  ): Promise<{ asset?: SavedAsset; failure?: FailedAsset }> {
    try {
      if (asset.source === 'inline-svg') {
        const path = `${directory}/${asset.asset.id}.svg`
        await this.filesystem.writeFile(path, asset.asset.markup)
        return {
          asset: {
            contentType: 'image/svg+xml',
            id: asset.asset.id,
            kind: 'image',
            name: asset.asset.name,
            path,
            url: assetUrl(asset)
          }
        }
      }
      const info = asset.asset,
        data = await this.readAsset(tabId, info.url, fallback),
        mime = normalizedMime(data.contentType)
      if (
        !validMime(info.kind, mime) &&
        !(mime === 'application/octet-stream' && assetKind(info.url) === info.kind)
      ) {
        this.reportFailure?.(
          this.runtime,
          info.kind,
          mime,
          'content_type_mismatch',
          this.clientInfo
        )
        return {
          failure: this.failure(
            asset,
            mime,
            `Asset response type ${mime ?? 'missing'} is not valid for ${info.kind}`
          )
        }
      }
      const path = `${directory}/${info.id}${extension(info.url)}`
      await this.filesystem.writeFile(
        path,
        Uint8Array.from(atob(data.base64), (character) => character.charCodeAt(0))
      )
      return {
        asset: {
          contentType: data.contentType,
          id: info.id,
          kind: info.kind,
          name: info.name,
          path,
          url: info.url
        }
      }
    } catch (error) {
      this.reportFailure?.(
        this.runtime,
        asset.source === 'inline-svg' ? 'image' : asset.asset.kind,
        null,
        'request_failed',
        this.clientInfo
      )
      return {
        failure: this.failure(
          asset,
          null,
          error instanceof Error ? error.message : 'Asset bundling failed'
        )
      }
    }
  }
}
