export type AssetKind = 'font' | 'image' | 'other' | 'script' | 'stylesheet' | 'video'
export interface AssetSource {
  kind: 'resource' | 'attribute' | 'computedStyle'
  property: string | undefined
  nodeId?: number
}
export interface PageAsset {
  id: string
  kind: AssetKind
  name: string
  sources: AssetSource[]
  url: string
}
export interface InlineSvg {
  id: string
  markup: string
  name: string
}
export interface AssetCdp {
  call(id: number, method: string, params?: Record<string, unknown>): Promise<unknown>
  evaluateJavascript(
    id: number,
    source: string,
    options?: { awaitPromise?: boolean }
  ): Promise<unknown>
}
interface SnapshotDocument {
  documentURL: number
  nodes: { backendNodeId?: number[]; nodeName?: number[]; attributes?: number[][] }
  layout: { nodeIndex: number[]; styles: number[][] }
}
interface Snapshot {
  strings: string[]
  documents: SnapshotDocument[]
}
const styleProperties = [
  'background-image',
  'border-image-source',
  'cursor',
  'list-style-image',
  'mask-image'
]
const indexed = (strings: string[], index: number | undefined) =>
  index == null || index < 0 ? '' : (strings[index] ?? '')
function pathname(input: string) {
  try {
    return new URL(input, 'https://example.invalid').pathname
  } catch {
    return input.split(/[?#]/, 1)[0] ?? input
  }
}
export function assetKind(input: string): AssetKind {
  const path = pathname(input).toLowerCase()
  return /\.(avif|gif|ico|jpe?g|png|svg|webp)$/.test(path)
    ? 'image'
    : /\.(mp4|mov|m4v|webm)$/.test(path)
      ? 'video'
      : /\.(otf|ttf|woff2?)$/.test(path)
        ? 'font'
        : /\.css$/.test(path)
          ? 'stylesheet'
          : /\.m?js$/.test(path)
            ? 'script'
            : 'other'
}
export function assetName(input: string) {
  const name = pathname(input).split('/').filter(Boolean).at(-1)
  if (!name) return input
  let fragment: string | null
  try {
    fragment = new URL(input, 'https://example.invalid').hash.slice(1) || null
  } catch {
    fragment = input.split('#', 2)[1] || null
  }
  return fragment == null ? name : `${name}#${fragment}`
}
export async function assetId(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}
type Discovered = Omit<PageAsset, 'id'>
function discovered(kind: AssetKind, source: AssetSource, url: string): Discovered {
  return {
    kind: kind === 'other' ? assetKind(url) : kind,
    name: assetName(url),
    sources: [source],
    url
  }
}
function resolveUrl(url: string, base: string) {
  try {
    return new URL(url, base || undefined).toString()
  } catch {
    return url
  }
}
function merge(map: Map<string, Discovered>, asset: Discovered) {
  const current = map.get(asset.url)
  if (current === undefined) {
    map.set(asset.url, asset)
    return
  }
  current.sources.push(...asset.sources)
  if (current.kind === 'other' && asset.kind !== 'other') current.kind = asset.kind
}
async function resources(cdp: AssetCdp, tabId: number) {
  const entries = (await cdp.evaluateJavascript(
    tabId,
    'performance.getEntriesByType("resource").map((entry) => ({ initiatorType: "initiatorType" in entry ? entry.initiatorType : undefined, name: entry.name }))'
  )) as { name?: string; initiatorType?: string }[] | null
  return (entries ?? []).flatMap((entry) => {
    if (!entry.name) return []
    let kind = assetKind(entry.name)
    if (kind === 'other')
      kind =
        (
          {
            css: 'stylesheet',
            font: 'font',
            img: 'image',
            script: 'script',
            video: 'video'
          } as Record<string, AssetKind>
        )[entry.initiatorType ?? ''] ?? kind
    return [discovered(kind, { kind: 'resource', property: entry.initiatorType }, entry.name)]
  })
}
export async function discoverPageAssets({
  cdp,
  tabId
}: {
  cdp: AssetCdp
  tabId: number
}): Promise<PageAsset[]> {
  const snapshot = (await cdp.call(tabId, 'DOMSnapshot.captureSnapshot', {
      computedStyles: [...styleProperties],
      includeDOMRects: false
    })) as Snapshot,
    document = snapshot.documents[0],
    observed = await resources(cdp, tabId)
  if (document === undefined)
    return await Promise.all(
      observed.map(async (asset) => ({ id: await assetId(asset.url), ...asset }))
    )
  const map = new Map<string, Discovered>()
  for (const asset of observed) merge(map, asset)
  const base = indexed(snapshot.strings, document.documentURL),
    add = (kind: AssetKind, source: AssetSource, raw: string) => {
      const asset = discovered(kind, source, resolveUrl(raw, base))
      if (map.has(asset.url)) merge(map, asset)
    }
  for (const [index, nodeId] of (document.nodes.backendNodeId ?? []).entries()) {
    if (nodeId <= 0) continue
    const tag = indexed(snapshot.strings, document.nodes.nodeName?.[index]).toLowerCase(),
      indices = document.nodes.attributes?.[index] ?? [],
      attributes: Record<string, string> = {}
    for (let at = 0; at < indices.length; at += 2) {
      const name = indexed(snapshot.strings, indices[at])
      if (name.length > 0) attributes[name] = indexed(snapshot.strings, indices[at + 1])
    }
    const attribute = (property: string, kind: AssetKind) => {
        const value = attributes[property]
        if (value) add(kind, { kind: 'attribute', nodeId, property }, value)
      },
      srcset = (kind: AssetKind) => {
        const value = attributes.srcset
        if (!value) return
        for (const candidate of value.split(',')) {
          const raw = candidate.trim().split(/\s+/, 1)[0]
          if (raw) add(kind, { kind: 'attribute', nodeId, property: 'srcset' }, raw)
        }
      }
    switch (tag) {
      case 'img':
        attribute('src', 'image')
        srcset('image')
        break
      case 'source':
        attribute('src', 'video')
        srcset('image')
        break
      case 'video':
        attribute('poster', 'image')
        attribute('src', 'video')
        break
      case 'script':
        attribute('src', 'script')
        break
      case 'link':
        attribute('href', attributes.rel === 'stylesheet' ? 'stylesheet' : 'other')
        break
      case 'use':
        attribute('href', 'image')
        attribute('xlink:href', 'image')
        break
    }
  }
  for (const [layoutIndex, nodeIndex] of document.layout.nodeIndex.entries()) {
    const nodeId = document.nodes.backendNodeId?.[nodeIndex]
    if (nodeId == null || nodeId <= 0) continue
    const styles = document.layout.styles[layoutIndex] ?? []
    for (const [at, property] of styleProperties.entries()) {
      const value = indexed(snapshot.strings, styles[at])
      for (const match of value.matchAll(/url\((["']?)(.*?)\1\)/g)) {
        const url = match[2]?.trim()
        if (url) add('image', { kind: 'computedStyle', nodeId, property }, url)
      }
    }
  }
  return await Promise.all(
    [...map.values()].map(async (asset) => ({ id: await assetId(asset.url), ...asset }))
  )
}
export async function discoverInlineSvgs({
  cdp,
  tabId
}: {
  cdp: Pick<AssetCdp, 'evaluateJavascript'>
  tabId: number
}): Promise<InlineSvg[]> {
  const values = (await cdp.evaluateJavascript(
    tabId,
    'Array.from(document.querySelectorAll("svg")).map((svg, index) => ({ markup: svg.outerHTML, name: svg.getAttribute("aria-label") || svg.querySelector("title")?.textContent?.trim() || svg.id || "svg-" + (index + 1) }))'
  )) as { markup: string; name?: string }[] | null
  return await Promise.all(
    (values ?? []).flatMap((svg, index) =>
      svg.markup
        ? [
            assetId(`${index}:${svg.markup}`).then((id) => ({
              id,
              markup: svg.markup,
              name: svg.name || `svg-${index + 1}`
            }))
          ]
        : []
    )
  )
}
