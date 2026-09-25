import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TASK_OUTPUT_OPEN_CHANNEL,
  type TaskOutputOpenRequest
} from '../shared/task-output-contract'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.png', '.jpg', '.jpeg', '.webp'])

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
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength === 0) throw new Error('TASK_OUTPUT_UNAVAILABLE')
    const directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), 'actiondriver-open-'))
    const path = join(
      directory,
      `${request.fileId}${safeExtension(response.headers.get('content-type'))}`
    )
    await writeFile(path, bytes, { mode: 0o600 })
    const failure = await options.openPath(path)
    if (failure) throw new Error(failure)
    return { opened: true }
  })
}

function readRequest(input: unknown): TaskOutputOpenRequest {
  const candidate = input as Partial<TaskOutputOpenRequest> | null
  if (
    !candidate ||
    typeof candidate.fileId !== 'string' ||
    typeof candidate.taskId !== 'string' ||
    typeof candidate.sessionId !== 'string' ||
    !ID_PATTERN.test(candidate.fileId) ||
    !ID_PATTERN.test(candidate.taskId) ||
    !ID_PATTERN.test(candidate.sessionId)
  ) {
    throw new Error('TASK_OUTPUT_REQUEST_INVALID')
  }
  return {
    fileId: candidate.fileId,
    taskId: candidate.taskId,
    sessionId: candidate.sessionId
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
