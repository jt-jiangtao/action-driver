interface Snapshot {
  full: string
  iframeRefs: string[]
  iframeDepths: Record<string, number>
}
interface Context {
  isIabBackend: boolean
  playwright: {
    evaluateOnPlaywrightPage(
      id: number,
      page: (injected: any) => Snapshot,
      options: Record<string, unknown>
    ): Promise<Snapshot>
    evaluateOnPlaywrightSelector(
      id: number,
      selector: string,
      page: (element: any, injected: any) => Snapshot,
      options: Record<string, unknown>
    ): Promise<Snapshot>
  }
}
const separator = ' >> internal:control=enter-frame >> '
// The root callback crosses a Runtime.evaluate source boundary and must include its helper body.
const rootPage = new Function(
  'injected',
  `return (${snapshotPage.toString()})(document.body || document.documentElement, injected)`
) as (injected: any) => Snapshot
/** Browser realm: only frames still represented by visible, non-hidden iframe elements are recursed. */
function snapshotPage(element: any, injected: any): Snapshot {
  if (!element) return { full: '', iframeDepths: {}, iframeRefs: [] }
  const snapshot = injected.incrementalAriaSnapshot(element, { mode: 'ai' })
  let full = snapshot.full
  const refs = snapshot.iframeRefs.filter((ref: string) => {
    if (!(ref in snapshot.iframeDepths)) return false
    try {
      const [frame] = injected.querySelectorAll(injected.parseSelector(`aria-ref=${ref}`), element)
      if (frame == null) return false
      const id = frame.getAttribute('id'),
        name = frame.getAttribute('name'),
        hints = [
          ...(id ? [`[id=${JSON.stringify(id)}]`] : []),
          ...(name ? [`[name=${JSON.stringify(name)}]`] : [])
        ].join(' ')
      if (hints)
        full = full.replace(
          /^([ \t]*- iframe(?: [^\r\n]*)?) \[ref=([^\]\r\n]+)\]/gm,
          (line: string, prefix: string, found: string) =>
            found === ref ? `${prefix} ${hints} [ref=${ref}]` : line
        )
      return (
        frame.getAttribute('aria-hidden') !== 'true' &&
        injected.elementState(frame, 'visible').matches === true
      )
    } catch {
      return false
    }
  })
  return { ...snapshot, full, iframeRefs: refs }
}
function frameRef(line: string) {
  return line.trimStart().startsWith('- iframe')
    ? (line.match(/\[ref=([^\]]+)\]/)?.[1] ?? null)
    : null
}
async function expand(
  context: Context,
  id: number,
  snapshot: Snapshot,
  timeoutMs: number,
  path?: string,
  deadlineMs?: number
): Promise<string> {
  const refs = snapshot.iframeRefs.filter((ref) => ref in snapshot.iframeDepths)
  if (!refs.length || (deadlineMs != null && Date.now() >= deadlineMs)) return snapshot.full
  const children = new Map(
    await Promise.all(
      refs.map(
        async (ref) => [ref, await child(context, id, ref, timeoutMs, path, deadlineMs)] as const
      )
    )
  )
  const result: string[] = []
  for (const line of snapshot.full.split('\n')) {
    const ref = frameRef(line),
      nested = ref == null ? undefined : children.get(ref)
    if (!nested) {
      result.push(line)
      continue
    }
    const indent = line.match(/^ */)?.[0] ?? ''
    result.push(
      line.endsWith(':') ? line : `${line}:`,
      ...nested.split('\n').map((child) => `${indent}  ${child}`)
    )
  }
  return result.join('\n')
}
async function child(
  context: Context,
  id: number,
  ref: string,
  timeoutMs: number,
  path?: string,
  deadlineMs?: number
) {
  try {
    const current = path ? `${path}${separator}aria-ref=${ref}` : `aria-ref=${ref}`
    if (deadlineMs != null && Date.now() >= deadlineMs) return null
    const budget =
      deadlineMs == null
        ? timeoutMs
        : Math.max(1, Math.min(timeoutMs, 500, deadlineMs - Date.now()))
    const snapshot = await context.playwright.evaluateOnPlaywrightSelector(
      id,
      `${current}${separator}body`,
      snapshotPage,
      {
        ...(deadlineMs == null ? {} : { deadlineMs }),
        retry: false,
        scrollFrameIntoView: false,
        timeoutMs: budget
      }
    )
    return await expand(context, id, snapshot, timeoutMs, current, deadlineMs)
  } catch {
    return null
  }
}
interface Tree {
  children: Tree[]
  indent: number
  line: string
}
function parse(text: string): Tree[] {
  const root: Tree = { children: [], indent: -1, line: '' },
    stack = [root]
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const indent = line.match(/^ */)?.[0].length ?? 0,
      node: Tree = { children: [], indent, line: line.slice(indent) }
    while (stack.length > 1 && indent <= stack.at(-1)!.indent) stack.pop()
    stack.at(-1)!.children.push(node)
    stack.push(node)
  }
  return root.children
}
function clean(node: Tree): Tree[] {
  const children = node.children.flatMap(clean),
    line = node.line.replace(/ \[ref=[^\]]+\]/g, '').replace(/ \[cursor=[^\]]+\]/g, '')
  return /^- img(?: \[[^\]]+\])*:?$/.test(line)
    ? []
    : /^- (generic|listitem|group)(?: \[[^\]]+\])*:?$/.test(line)
      ? children
      : [{ children, indent: node.indent, line }]
}
function render(nodes: Tree[], depth = 0): string {
  return nodes
    .map((node) =>
      ['  '.repeat(depth) + node.line, render(node.children, depth + 1)].filter(Boolean).join('\n')
    )
    .join('\n')
}
function normalized(snapshot: string) {
  return !snapshot.startsWith('- ') && !snapshot.includes('\n- ') && !snapshot.includes('\n  - ')
    ? snapshot
    : render(parse(snapshot).flatMap(clean))
}
export async function playwrightDomSnapshot(
  params: { tab_id: number; timeout_ms?: number },
  context: Context
) {
  const timeoutMs = Math.min(
      Math.max(0, typeof params.timeout_ms === 'number' ? params.timeout_ms : 3000),
      3000
    ),
    top = await context.playwright.evaluateOnPlaywrightPage(params.tab_id, rootPage, { timeoutMs }),
    deadlineMs = context.isIabBackend ? Date.now() + 1000 : undefined
  return {
    dom_snapshot: normalized(
      await expand(context, params.tab_id, top, timeoutMs, undefined, deadlineMs)
    )
  }
}
