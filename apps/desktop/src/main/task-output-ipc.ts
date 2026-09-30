import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseResourceUri } from '@action-driver/runtime-contracts'
import {
  TASK_OUTPUT_OPEN_CHANNEL,
  type TaskOutputOpenRequest
} from '../shared/task-output-contract'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.png', '.jpg', '.jpeg', '.webp'])

type ReadRequest =
  | { kind: 'resource'; uri: string; taskId: string; sessionId: string }
  | { kind: 'legacy'; fileId: string; taskId: string; sessionId: string }

export function registerTaskOutputIpc(
  ipc: {
    handle(channel: string, handler: (_event: unknown, input: unknown) => Promise<unknown>): void
  },
  options: {
    connection: () => Promise<{ serviceUrl: string; token: string }>
    openPath: (path: string) => Promise<string>
    fetchImpl?: typeof fetch
    temporaryRoot?: string
  }
): void {
  const fetchImpl = options.fetchImpl ?? fetch
  ipc.handle(TASK_OUTPUT_OPEN_CHANNEL, async (_event, input) => {
    const request = readRequest(input)
    const connection = await options.connection()
    const { bytes, contentType } = request.kind === 'resource'
      ? await readResource(request, connection)
      : await readLegacy(request, connection)
    if (bytes.byteLength === 0) throw new Error('TASK_OUTPUT_UNAVAILABLE')
    const directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), 'action-driver-open-'))
    const path = join(
      directory,
      `${request.kind === 'legacy' ? request.fileId : 'resource'}${safeExtension(contentType)}`
    )
    await writeFile(path, bytes, { mode: 0o600 })
    const failure = await options.openPath(path)
    if (failure) throw new Error(failure)
    return { opened: true }
  })

  async function readLegacy(
    request: Extract<ReadRequest, { kind: 'legacy' }>,
    connection: { serviceUrl: string; token: string }
  ): Promise<{ bytes: Buffer; contentType: string | null }> {
    const url = new URL(
      `/sessions/${encodeURIComponent(request.sessionId)}/outputs/${encodeURIComponent(
        request.fileId
      )}/content`,
      connection.serviceUrl
    )
    url.searchParams.set('taskId', request.taskId)
    const response = await fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${connection.token}` }
    })
    if (!response.ok) throw new Error('TASK_OUTPUT_UNAVAILABLE')
    return { bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') }
  }

  /**
   * A resource URI is resolved by the runtime that owns it, so the desktop never turns a URI into a
   * local path: only the returned controlled bytes reach `openPath`.
   */
  async function readResource(
    request: Extract<ReadRequest, { kind: 'resource' }>,
    connection: { serviceUrl: string; token: string }
  ): Promise<{ bytes: Buffer; contentType: string | null }> {
    const response = await fetchImpl(new URL('/resources/read', connection.serviceUrl).toString(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ uri: request.uri, taskId: request.taskId, sessionId: request.sessionId })
    })
    if (!response.ok) throw new Error('TASK_OUTPUT_UNAVAILABLE')
    const payload = (await response.json()) as {
      ok?: boolean
      value?: { base64?: string; contentType?: string }
    }
    if (!payload.ok || typeof payload.value?.base64 !== 'string') throw new Error('TASK_OUTPUT_UNAVAILABLE')
    return {
      bytes: Buffer.from(payload.value.base64, 'base64'),
      contentType: payload.value.contentType ?? null
    }
  }
}

/** Accepts either the unified resource URI or the legacy file id, and nothing else. */
function readRequest(input: unknown): ReadRequest {
  const candidate = input as Partial<TaskOutputOpenRequest> | null
  if (!candidate || typeof candidate.taskId !== 'string' || typeof candidate.sessionId !== 'string') throw new Error('TASK_OUTPUT_REQUEST_INVALID')
  if (!ID_PATTERN.test(candidate.taskId) || !ID_PATTERN.test(candidate.sessionId)) throw new Error('TASK_OUTPUT_REQUEST_INVALID')
  const hasUri = typeof candidate.uri === 'string' && candidate.uri.length > 0
  const hasFileId = typeof candidate.fileId === 'string' && candidate.fileId.length > 0
  if (hasUri === hasFileId) throw new Error('TASK_OUTPUT_REQUEST_INVALID')
  if (hasUri) return { kind: 'resource', uri: assertResourceUri(candidate.uri!), taskId: candidate.taskId, sessionId: candidate.sessionId }
  if (!ID_PATTERN.test(candidate.fileId!)) throw new Error('TASK_OUTPUT_REQUEST_INVALID')
  return { kind: 'legacy', fileId: candidate.fileId!, taskId: candidate.taskId, sessionId: candidate.sessionId }
}

/** Only canonical `adr://v1/<scheme>/<id>` references pass; a path or foreign URL is rejected. */
function assertResourceUri(uri: string): string {
  try {
    parseResourceUri(uri)
    return uri
  } catch {
    throw new Error('TASK_OUTPUT_REQUEST_INVALID')
  }
}

function safeExtension(contentType: string | null): string {
  const mime = (contentType ?? '').split(';')[0]?.trim().toLowerCase()
  const byMime: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp'
  }
  const extension = byMime[mime ?? ''] ?? '.bin'
  return EXTENSIONS.has(extension) ? extension : '.bin'
}
