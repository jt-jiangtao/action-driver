import {
  cleanExportMarkdown,
  workspaceDocument,
  workspaceExportName,
  youtubeVideoId
} from './service-browser-user.js'
import { fetchGoogleExportPage, fetchYoutubeTranscriptPage, transcriptLimits } from './service-content-export-page.js'

type Format = 'pdf' | 'md' | 'docx' | 'xlsx' | 'csv' | 'pptx'
interface Context {
  tabs: { get(id: number): Promise<{ url: string; title?: string }> }
  cdp: {
    evaluateJavascript(
      id: number,
      expression: string,
      options: { awaitPromise: true }
    ): Promise<any>
  }
  filesystem: {
    tmpDir: string
    mkdir(path: string, options: { recursive: true }): Promise<unknown>
    writeFile(path: string, bytes: Uint8Array): Promise<unknown>
  }
}
const formatByDocument: Record<string, ReadonlySet<Format>> = {
  document: new Set(['pdf', 'md', 'docx']),
  spreadsheets: new Set(['pdf', 'xlsx', 'csv']),
  presentation: new Set(['pdf', 'pptx'])
}
const formats = new Set<Format>(['pdf', 'md', 'xlsx', 'csv', 'docx', 'pptx'])
const tabId = (value: unknown) => {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) throw new Error('Expected a positive integer')
  return number
}
const exportDir = (context: Context) => `${context.filesystem.tmpDir}/browser-use/exports`
function googleExportUrl(document: NonNullable<ReturnType<typeof workspaceDocument>>, format: Format) {
  const url = new URL(`https://docs.google.com/${document.docType}/d/${document.docId}/export`)
  url.searchParams.set('format', format)
  const selectedTab = document.url.searchParams.get('tab')
  if (selectedTab != null) url.searchParams.append('tab', selectedTab)
  url.hash = document.url.hash
  return url.toString()
}
function decodedExport(bytes: { base64: string }, format: Format) {
  const raw = Uint8Array.from(atob(bytes.base64), (character) => character.charCodeAt(0))
  return format === 'md'
    ? new TextEncoder().encode(cleanExportMarkdown(new TextDecoder().decode(raw)))
    : raw
}
async function exportGoogleWorkspace(
  params: { tab_id: unknown; format: unknown },
  context: Context
) {
  const id = tabId(params.tab_id)
  if (typeof params.format !== 'string' || !formats.has(params.format as Format))
    throw new Error('tab_content_export_gsuite requires supported format')
  const format = params.format as Format
  const tab = await context.tabs.get(id)
  const document = workspaceDocument(tab.url)
  if (document === null) throw new Error('Tab is not a Google Workspace document')
  if (!formatByDocument[document.docType]?.has(format))
    throw new Error('GSuite export type is not supported for this tab')
  const response = await context.cdp.evaluateJavascript(
    id,
    `(${fetchGoogleExportPage.toString()})(${JSON.stringify({ exportUrl: googleExportUrl(document, format) })})`,
    { awaitPromise: true }
  )
  if (response?.base64 == null)
    throw new Error('Unable to export GSuite content for this tab')
  const directory = exportDir(context)
  await context.filesystem.mkdir(directory, { recursive: true })
  const path = `${directory}/${workspaceExportName(tab.title)}-${crypto.randomUUID()}.${format}`
  const bytes = decodedExport(response, format)
  if (bytes.length === 0) throw new Error('Unable to export GSuite content for this tab')
  try {
    await context.filesystem.writeFile(path, bytes)
  } catch (cause) {
    throw new Error('Unable to write exported content to disk', { cause })
  }
  return { path }
}

interface TranscriptPageResult {
  body: string
  captionKind: string | null
  captionLanguage: string | null
  pageUrl: string
}
function validTranscriptPage(value: unknown): value is TranscriptPageResult {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    Object.keys(record).length === 4 &&
    typeof record.body === 'string' &&
    (record.captionKind === null ||
      (typeof record.captionKind === 'string' && record.captionKind.length <= 100)) &&
    (record.captionLanguage === null ||
      (typeof record.captionLanguage === 'string' && record.captionLanguage.length <= 100)) &&
    typeof record.pageUrl === 'string'
  )
}
function transcriptEvent(value: unknown) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const event = value as Record<string, unknown>
  if (
    typeof event.tStartMs !== 'number' ||
    !Number.isFinite(event.tStartMs) ||
    event.tStartMs < 0 ||
    !Array.isArray(event.segs) ||
    !event.segs.every(
      (segment) =>
        segment != null &&
        typeof segment === 'object' &&
        !Array.isArray(segment) &&
        (!('utf8' in segment) ||
          (segment as Record<string, unknown>).utf8 === undefined ||
          typeof (segment as Record<string, unknown>).utf8 === 'string')
    )
  ) return null
  return { tStartMs: event.tStartMs, segs: event.segs as Array<{ utf8?: string }> }
}
function transcriptText(videoId: string, page: TranscriptPageResult) {
  if (new TextEncoder().encode(page.body).byteLength > transcriptLimits.maxJsonBytes) return null
  let events: unknown[]
  try {
    const parsed = JSON.parse(page.body)
    if (parsed == null || typeof parsed !== 'object' || !Array.isArray(parsed.events)) return null
    events = parsed.events
  } catch { return null }
  const lines = [
    'YouTube transcript',
    `Video ID: ${videoId}`,
    `Language: ${page.captionLanguage ?? 'unknown'}`,
    `Captions: ${page.captionKind === 'asr' ? 'auto-generated' : 'authored or unspecified'}`,
    ''
  ]
  const encoder = new TextEncoder()
  let total = encoder.encode(lines.join('\n')).byteLength
  let count = 0
  let truncated = false
  for (const entry of events) {
    if (count >= transcriptLimits.maxItems) { truncated = true; break }
    const event = transcriptEvent(entry)
    if (event === null) continue
    const value = event.segs.map((part) => part.utf8 ?? '').join('').replace(/\s+/g, ' ').trim()
    if (value.length === 0) continue
    const seconds = Math.floor(event.tStartMs / 1000)
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const remainder = seconds % 60
    const at =
      hours > 0
        ? `${hours}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
        : `${minutes}:${remainder.toString().padStart(2, '0')}`
    const line = `[${at}] ${value}`
    const size = encoder.encode(`\n${line}`).byteLength
    if (total + size > transcriptLimits.maxTextBytes) { truncated = true; break }
    lines.push(line)
    total += size
    count += 1
  }
  if (count === 0) return null
  if (truncated) lines.push('', '[Transcript truncated]')
  return { pageUrl: page.pageUrl, text: lines.join('\n'), truncated }
}
async function exportYoutubeTranscript(params: { tab_id: unknown }, context: Context) {
  const id = tabId(params.tab_id)
  const initial = await context.tabs.get(id)
  const videoId = youtubeVideoId(initial.url)
  if (videoId === null) throw new Error('Tab is not a supported YouTube watch page')
  const page = await context.cdp.evaluateJavascript(
    id,
    `(${fetchYoutubeTranscriptPage.toString()})(${JSON.stringify(videoId)},${JSON.stringify(transcriptLimits)})`,
    { awaitPromise: true }
  )
  const transcript = validTranscriptPage(page) ? transcriptText(videoId, page) : null
  if (transcript === null || youtubeVideoId(transcript.pageUrl) !== videoId)
    throw new Error('No transcript is available for this YouTube video')
  const current = await context.tabs.get(id)
  if (youtubeVideoId(current.url) !== videoId)
    throw new Error('YouTube video changed before its transcript was exported')
  const directory = exportDir(context)
  await context.filesystem.mkdir(directory, { recursive: true })
  const path = `${directory}/youtube-${videoId}-${crypto.randomUUID()}.txt`
  await context.filesystem.writeFile(path, new TextEncoder().encode(transcript.text))
  return { path }
}

export const contentExportHandlers = {
  tab_content_export_gsuite: exportGoogleWorkspace,
  tab_content_export_youtube_transcript: exportYoutubeTranscript
}
