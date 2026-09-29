import MarkdownIt from 'markdown-it'

/**
 * markdown-it 15 ships its own token types while the renderer is typed through
 * @types/markdown-it 14, so the two `Token` shapes are structurally different.
 * The runtime values are identical; only the types need bridging.
 */
type MarkdownItInstance = InstanceType<typeof MarkdownIt>
type ParsedToken = ReturnType<MarkdownItInstance['parse']>[number]
type RenderTokens = Parameters<MarkdownItInstance['renderer']['render']>[0]

/** Shared parser and renderer; exported so render-count tests can observe it. */
export const markdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})

export type MarkdownBlock = {
  /** Stable while the block source keeps its position in the document. */
  key: string
  html: string
}

const CACHE_LIMIT = 256
const htmlBySource = new Map<string, string>()

function renderCached(source: string, tokens: ParsedToken[], env: Record<string, unknown>): string {
  const cached = htmlBySource.get(source)
  if (cached !== undefined) return cached
  const html = markdownIt.renderer.render(tokens as unknown as RenderTokens, markdownIt.options, env)
  htmlBySource.set(source, html)
  if (htmlBySource.size > CACHE_LIMIT) {
    const oldest = htmlBySource.keys().next().value
    if (oldest !== undefined) htmlBySource.delete(oldest)
  }
  return html
}

/**
 * Renders markdown in top-level blocks so a streaming message only re-renders
 * its open tail. Blocks are grouped by token nesting, never by blank lines:
 * splitting a loose list or a fenced code block at a blank line would render
 * different HTML than rendering the whole message at once. The concatenated
 * `html` of every block equals `markdownIt.render(content)`.
 */
export function markdownBlocks(content: string): MarkdownBlock[] {
  if (content.length === 0) return []
  const env: Record<string, unknown> = {}
  const tokens = markdownIt.parse(content, env)
  const lines = content.split('\n')
  const blocks: MarkdownBlock[] = []
  let group: ParsedToken[] = []
  let depth = 0
  let start = 0
  const flush = () => {
    if (group.length === 0) return
    const ranges = group
      .map((token) => token.map)
      .filter((range): range is [number, number] => range !== null)
    const end = ranges.length ? Math.max(...ranges.map((range) => range[1])) : lines.length
    const source = lines.slice(start, end).join('\n')
    blocks.push({ key: `${start}:${end}`, html: renderCached(source, group, env) })
    group = []
  }
  for (const token of tokens) {
    // A block token that closes back to depth zero ends the current block group.
    if (depth === 0 && group.length > 0) flush()
    if (group.length === 0 && token.map) start = token.map[0]
    group.push(token)
    depth += token.nesting
  }
  flush()
  return blocks
}

/** Visible for tests that assert a repeated block is served from the cache. */
export function markdownBlockCacheSize(): number {
  return htmlBySource.size
}
