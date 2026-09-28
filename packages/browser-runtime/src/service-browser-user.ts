interface PageContext {
  text: string
  title: string
  truncated: boolean
  url: string
}
interface TextContext extends PageContext {
  kind: 'text'
}
interface DocumentContext {
  kind: 'document'
  dataBase64: string
  fileName: string
  mimeType: string
  title: string
  url: string
}
type Read = (request: { kind: string; format?: string }) => Promise<unknown>
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object'
export function workspaceDocument(input: string | undefined) {
  if (input == null) return null
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.host !== 'docs.google.com') return null
  const parts = url.pathname.split('/').filter(Boolean),
    type = parts[0]
  if (type !== 'document' && type !== 'presentation' && type !== 'spreadsheets') return null
  const at = parts.indexOf('d', 1),
    id = at < 0 ? undefined : parts[at + 1]
  if (!id || parts.at(-1) === 'pub') return null
  return { docId: id, docType: type, url }
}
export function workspaceExportName(
  title: string | null | undefined,
  fallback = 'ExportedContent'
) {
  const parts = (title ?? 'Asset').split(' - '),
    name = (
      parts.length > 1 && parts.at(-1)?.startsWith('Google')
        ? parts.slice(0, -1).join(' - ')
        : parts.join(' - ')
    )
      .replaceAll(/[/\\?%*|"<>:]/g, '_')
      .trim()
  return name.length === 0 ? fallback : name
}
export function cleanExportMarkdown(text: string) {
  return text.replace(/^\s*\[[^\]]+\]:\s*<data:[^>]+>\s*\n?/gm, '').trim()
}
function exportValue(
  value: unknown
): { errorMessage: string } | { redirectUrl: string } | { base64: string; truncated: boolean } {
  if (!record(value)) return { errorMessage: 'Unable to export content' }
  if (typeof value.errorMessage === 'string') return { errorMessage: value.errorMessage }
  if (typeof value.redirectUrl === 'string') return { redirectUrl: value.redirectUrl }
  return typeof value.base64 !== 'string' || value.base64.length === 0
    ? { errorMessage: 'Unable to export content' }
    : { base64: value.base64, truncated: value.truncated === true }
}
async function workspaceContext(expectedUrl: string, title: string, read: Read) {
  const doc = workspaceDocument(expectedUrl)
  if (doc === null) return null
  const formats =
    doc.docType === 'document'
      ? ['md', 'pdf']
      : doc.docType === 'presentation'
        ? ['pdf']
        : ['xlsx', 'pdf']
  for (const format of formats) {
    let value: ReturnType<typeof exportValue>
    try {
      value = exportValue(await read({ kind: 'googleWorkspaceExport', format }))
    } catch (error) {
      if (
        (error instanceof Error ? error.message : error) ===
        'The selected tab changed while being read'
      )
        throw error
      continue
    }
    if ('errorMessage' in value) {
      if (value.errorMessage === 'Google Workspace export is too large for in-memory tab context')
        throw Error(value.errorMessage)
      continue
    }
    if ('redirectUrl' in value) continue
    if (format === 'md')
      return {
        kind: 'text' as const,
        text: cleanExportMarkdown(
          new TextDecoder().decode(
            Uint8Array.from(atob(value.base64), (character) => character.charCodeAt(0))
          )
        ),
        truncated: value.truncated
      }
    return {
      dataBase64: value.base64,
      fileName: `${workspaceExportName(title)}.${format}`,
      kind: 'document' as const,
      mimeType:
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }
  }
  return null
}
function pageContext(value: unknown, expectedUrl: string): PageContext {
  if (
    !record(value) ||
    value.url !== expectedUrl ||
    typeof value.title !== 'string' ||
    value.title.length > 4096 ||
    typeof value.text !== 'string' ||
    typeof value.truncated !== 'boolean'
  )
    throw Error('Unable to read tab context for the authorized page')
  return { text: value.text, title: value.title, truncated: value.truncated, url: expectedUrl }
}
export function youtubeVideoId(input: string | undefined) {
  if (input == null) return null
  try {
    const url = new URL(input)
    if (
      url.protocol !== 'https:' ||
      !['www.youtube.com', 'youtube.com'].includes(url.hostname) ||
      url.pathname !== '/watch'
    )
      return null
    const id = url.searchParams.get('v')
    return id !== null && /^[A-Za-z0-9_-]{11}$/u.test(id) ? id : null
  } catch {
    return null
  }
}
async function selectionContext(read: Read) {
  try {
    const value = await read({ kind: 'selection' })
    return record(value) && typeof value.text === 'string' && typeof value.truncated === 'boolean'
      ? { text: value.text, truncated: value.truncated }
      : null
  } catch {
    return null
  }
}
export async function readUserTabContext({
  expectedUrl,
  read
}: {
  expectedUrl: string
  read: Read
}): Promise<TextContext | DocumentContext> {
  const page = pageContext(await read({ kind: 'page' }), expectedUrl),
    exported = await workspaceContext(page.url, page.title, read)
  if (exported !== null) return { ...exported, title: page.title, url: page.url }
  const video = youtubeVideoId(page.url),
    selection =
      video === null
        ? null
        : await selectionContext(read).then((value) =>
            value?.text.trim() === page.text.trim() ? null : value
          )
  if (video !== null && selection === null)
    try {
      const transcript = await read({ kind: 'youtubeTranscript' })
      if (
        record(transcript) &&
        typeof transcript.pageUrl === 'string' &&
        typeof transcript.text === 'string' &&
        typeof transcript.truncated === 'boolean' &&
        transcript.pageUrl === expectedUrl
      )
        return {
          kind: 'text',
          text: [
            page.text,
            '',
            '<browser__youtube_transcript>',
            transcript.text,
            '</browser__youtube_transcript>'
          ].join('\n'),
          title: page.title,
          truncated: page.truncated || transcript.truncated,
          url: page.url
        }
    } catch {}
  if (selection !== null)
    return {
      kind: 'text',
      text: [
        '<user__selection>',
        selection.text,
        '</user__selection>',
        '',
        '<browser__document__content>',
        page.text,
        '</browser__document__content>'
      ].join('\n'),
      title: page.title,
      truncated: page.truncated || selection.truncated,
      url: page.url
    }
  return { kind: 'text', ...page }
}
interface UserApi {
  getUserTabs(): Promise<unknown>
  claimUserTab(id: number): Promise<unknown>
  executeTabRead(params: {
    tabId: number
    expectedUrl: string
    read: { kind: string; format?: string }
  }): Promise<unknown>
}
export class BrowserUser {
  constructor(
    private api: UserApi,
    private captureTabPdfToLibrary?: (params: {
      tabId: number
      expectedUrl: string
    }) => Promise<Record<string, unknown> | null | undefined>
  ) {}
  async openTabs() {
    return await this.api.getUserTabs()
  }
  async claimTab(id: number) {
    return await this.api.claimUserTab(id)
  }
  async getTabContext(id: number, expectedUrl: string) {
    const pdf = await this.captureTabPdfToLibrary?.({ tabId: id, expectedUrl })
    return pdf != null
      ? { kind: 'library_file', ...pdf, mimeType: 'application/pdf', url: expectedUrl }
      : await readUserTabContext({
          expectedUrl,
          read: (read) => this.api.executeTabRead({ tabId: id, expectedUrl, read })
        })
  }
}
