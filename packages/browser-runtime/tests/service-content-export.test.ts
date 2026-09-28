// @vitest-environment node
import { test, expect } from 'vitest'
import { originalDocumentation } from './original-service'

const candidate = async () =>
  ((await import('../src/service-content-export').catch(() => ({}))) as any).contentExportHandlers

const tab = (url: string, title = 'Report/2026 - Google Docs') => ({ url, title })
function setup(url: string, title?: string) {
  const files = new Map<string, Uint8Array>()
  const calls: unknown[] = []
  const state = { current: tab(url, title) }
  const context = {
    tabs: { get: async (id: number) => { calls.push(['get', id]); return state.current } },
    cdp: {
      evaluateJavascript: async (id: number, script: string, options: unknown) => {
        calls.push(['eval', id, options])
        return { base64: Buffer.from('  [image]: <data:image/png;base64,abc>\n\nHello  ').toString('base64') }
      }
    },
    filesystem: {
      tmpDir: '/tmp/export-test',
      mkdir: async (path: string, options: unknown) => { calls.push(['mkdir', path, options]) },
      writeFile: async (path: string, bytes: Uint8Array) => { calls.push(['write', path]); files.set(path, bytes) }
    }
  }
  return { context, state, files, calls }
}
function resultOf(run: () => Promise<unknown>) {
  return run().then(
    (result: any) => ({ result }),
    (error: any) => ({ error: error.message, cause: error.cause?.message })
  )
}

test('Google Workspace export validates format/document, fetches in-page and writes sanitized bytes', async () => {
  const own = await candidate()
  expect(own).toBeDefined()
  const base = await originalDocumentation()
  async function run(handler: any, url: string, format: string, title?: string) {
    const { context, files, calls } = setup(url, title)
    const outcome = await resultOf(() => handler({ tab_id: 3, format }, context))
    const path = (outcome as any).result?.path as string | undefined
    return {
      ...outcome,
      result: path ? { path: path.replace(/-[0-9a-f-]{36}\./, '-uuid.') } : undefined,
      bytes: path ? Buffer.from(files.get(path) ?? []).toString() : undefined,
      calls: calls.map((call: any) => call[0] === 'write' ? ['write', call[1].replace(/-[0-9a-f-]{36}\./, '-uuid.')] : call)
    }
  }
  for (const [url, format] of [
    ['https://docs.google.com/document/d/id/edit?tab=t.1#section', 'md'],
    ['https://docs.google.com/spreadsheets/d/id/edit', 'xlsx'],
    ['https://docs.google.com/presentation/d/id/edit', 'pptx'],
    ['https://example.com/', 'pdf'],
    ['https://docs.google.com/document/d/id/edit', 'bad']
  ])
    expect(await run(own.tab_content_export_gsuite, url, format)).toEqual(
      await run(base.baselineWorkspaceExportCommand, url, format)
    )
})

test('YouTube transcript export formats captions and rejects changed videos', async () => {
  const own = await candidate()
  expect(own).toBeDefined()
  const base = await originalDocumentation()
  async function run(handler: any, variant: 'success' | 'changed' | 'empty' | 'invalid') {
    const url = variant === 'invalid' ? 'https://example.com/' : 'https://www.youtube.com/watch?v=abcdefghijk'
    const { context, state, files, calls } = setup(url)
    context.cdp.evaluateJavascript = async (id: number, script: string, options: unknown) => {
      calls.push(['eval', id, options])
      if (variant === 'changed') state.current = tab('https://www.youtube.com/watch?v=abcdefghijl')
      return {
        body: JSON.stringify({ events: variant === 'empty' ? [] : [
          { tStartMs: 1234, segs: [{ utf8: 'Hello ' }, { utf8: ' world' }] },
          { tStartMs: 61000, segs: [{ utf8: 'Next line' }] }
        ] }),
        captionKind: 'asr',
        captionLanguage: 'en',
        pageUrl: 'https://www.youtube.com/watch?v=abcdefghijk'
      }
    }
    const outcome = await resultOf(() => handler({ tab_id: 3 }, context))
    const path = (outcome as any).result?.path as string | undefined
    return {
      ...outcome,
      result: path ? { path: path.replace(/-[0-9a-f-]{36}\./, '-uuid.') } : undefined,
      bytes: path ? Buffer.from(files.get(path) ?? []).toString() : undefined,
      calls: calls.map((call: any) => call[0] === 'write' ? ['write', call[1].replace(/-[0-9a-f-]{36}\./, '-uuid.')] : call)
    }
  }
  for (const variant of ['success', 'changed', 'empty', 'invalid'] as const)
    expect(await run(own.tab_content_export_youtube_transcript, variant)).toEqual(
      await run(base.baselineYoutubeTranscriptExportCommand, variant)
    )
})
