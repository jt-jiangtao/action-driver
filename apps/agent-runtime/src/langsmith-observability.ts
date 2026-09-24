import { Client } from 'langsmith'
import type { Run } from 'langsmith/schemas'
import type {
  ModelLogQuery,
  ModelLogSessionProjection,
  ModelLogTaskProjection,
  ModelRef,
  ModelRunStatus
} from '@actiondriver/contracts'
import type { ModelTraceFinish, ModelTraceStart } from './model-trace-port'

const DEFAULT_ENDPOINT = 'https://api.smith.langchain.com'

export type LangSmithConfiguration =
  | { available: false; reason: string }
  | { available: true; endpoint: string; webOrigin: string; project: string }

export function createLangSmithConfiguration(
  environment: NodeJS.ProcessEnv
): LangSmithConfiguration {
  const apiKey = environment.LANGSMITH_API_KEY?.trim()
  if (!apiKey) return { available: false, reason: 'LANGSMITH_API_KEY is required' }
  const endpoint = environment.LANGSMITH_ENDPOINT?.trim() || DEFAULT_ENDPOINT
  const url = new URL(endpoint)
  if (url.protocol !== 'https:') throw new Error('LANGSMITH_ENDPOINT must use HTTPS')
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('LANGSMITH_ENDPOINT must be a credential-free HTTPS origin')
  }
  return {
    available: true,
    endpoint: url.origin,
    webOrigin:
      url.hostname === 'api.smith.langchain.com'
        ? 'https://smith.langchain.com'
        : url.hostname.endsWith('.api.smith.langchain.com')
          ? `https://${url.hostname.replace('.api.smith.langchain.com', '.smith.langchain.com')}`
          : url.origin,
    project: environment.LANGSMITH_PROJECT?.trim() || 'default'
  }
}

/** Creates the SDK client only inside the Runtime; callers must never pass this to IPC/UI code. */
export function createLangSmithClient(environment: NodeJS.ProcessEnv): Client | null {
  const configuration = createLangSmithConfiguration(environment)
  if (!configuration.available) return null
  const apiKey = environment.LANGSMITH_API_KEY?.trim()
  if (!apiKey) return null
  return new Client({ apiUrl: configuration.endpoint, webUrl: configuration.webOrigin, apiKey })
}

type RunCreate = Parameters<Client['createRun']>[0]
type RunUpdate = Parameters<Client['updateRun']>[1]
type RunQuery = Parameters<Client['listRuns']>[0]

export interface LangSmithClientPort {
  createRun(run: RunCreate): Promise<void>
  updateRun(id: string, run: RunUpdate): Promise<void>
  flush(): Promise<void>
  listRuns(query: RunQuery): AsyncIterable<Run>
}

export class LangSmithObservability {
  readonly configuration: LangSmithConfiguration
  private readonly client: LangSmithClientPort | null
  readonly webOrigin: string
  private readonly apiKey: string
  private readonly metadataByRun = new Map<string, Record<string, unknown>>()

  constructor(environment: NodeJS.ProcessEnv, client?: LangSmithClientPort) {
    this.apiKey = environment.LANGSMITH_API_KEY?.trim() || ''
    let configuration: LangSmithConfiguration
    let resolvedClient: LangSmithClientPort | null = null
    try {
      configuration = createLangSmithConfiguration(environment)
      resolvedClient = configuration.available
        ? (client ?? createLangSmithClient(environment))
        : null
    } catch {
      configuration = {
        available: false,
        reason: 'LANGSMITH_ENDPOINT is invalid or LangSmith SDK initialization failed'
      }
    }
    this.configuration = configuration
    this.client = resolvedClient
    this.webOrigin = this.configuration.available ? this.configuration.webOrigin : ''
  }

  async start(run: ModelTraceStart): Promise<void> {
    if (!this.client || !this.configuration.available) return
    const metadata = {
      source: 'actiondriver',
      thread_id: run.sessionId,
      sessionId: run.sessionId,
      taskId: run.taskId,
      ...(run.sessionName ? { sessionName: run.sessionName } : {}),
      requestId: run.requestId,
      correlationId: run.correlationId,
      connectionId: run.model.connectionId,
      modelId: run.model.modelId,
      status: 'running'
    }
    this.metadataByRun.set(run.id, metadata)
    await this.client.createRun({
      id: run.id,
      name: run.model.modelId,
      run_type: 'llm',
      project_name: this.configuration.project,
      start_time: run.startedAt,
      inputs: sanitize(run.input, this.apiKey) as Record<string, unknown>,
      extra: { metadata }
    })
  }

  async finish(id: string, result: ModelTraceFinish): Promise<void> {
    if (!this.client) return
    await this.client.updateRun(id, {
      end_time: result.completedAt,
      ...(result.output === undefined
        ? {}
        : { outputs: sanitize(result.output, this.apiKey) as Record<string, unknown> }),
      ...(result.error === undefined ? {} : { error: sanitizeText(result.error, this.apiKey) }),
      extra: {
        metadata: {
          ...this.metadataByRun.get(id),
          status: result.error === undefined ? 'completed' : 'failed',
          ...(result.usage === undefined ? {} : { usage: sanitize(result.usage, this.apiKey) })
        }
      }
    })
    await this.client.flush()
    this.metadataByRun.delete(id)
  }

  async list(query: ModelLogQuery): Promise<ModelLogSessionProjection[]> {
    if (!this.client || !this.configuration.available) {
      throw new Error(
        this.configuration.available ? 'LangSmith client unavailable' : this.configuration.reason
      )
    }
    const groups = new Map<string, ModelLogSessionProjection>()
    try {
      for await (const run of this.client.listRuns({
        projectName: this.configuration.project,
        isRoot: true,
        order: 'desc',
        limit: 100
      })) {
        const metadata = run.extra?.metadata as Record<string, unknown> | undefined
        if (metadata?.source !== 'actiondriver') continue
        const sessionId = asString(metadata?.sessionId)
        const taskId = asString(metadata?.taskId)
        if (!sessionId || !taskId) continue
        const status: ModelRunStatus = run.error ? 'failed' : run.end_time ? 'completed' : 'running'
        const startTime = asDate(run.start_time)
        const endTime = run.end_time ? asDate(run.end_time) : undefined
        const detailUrl = this.detailUrl(run.app_path)
        const task: ModelLogTaskProjection = {
          id: taskId,
          sessionId,
          name: run.name || taskId,
          startTime,
          ...(endTime ? { endTime } : {}),
          status,
          durationMs: endTime ? Math.max(0, Date.parse(endTime) - Date.parse(startTime)) : null,
          model: {
            connectionId: asString(metadata?.connectionId) || 'langsmith',
            modelId: asString(metadata?.modelId) || run.name
          },
          detailUrl,
          calls: []
        }
        const existing = groups.get(sessionId)
        if (existing) {
          const earlierTask = existing.tasks.find((item) => item.id === taskId)
          if (earlierTask) {
            if (task.startTime < earlierTask.startTime) earlierTask.startTime = task.startTime
            if (task.endTime && (!earlierTask.endTime || task.endTime > earlierTask.endTime))
              earlierTask.endTime = task.endTime
            if (status === 'failed' || (status === 'running' && earlierTask.status !== 'failed'))
              earlierTask.status = status
            earlierTask.durationMs = earlierTask.endTime
              ? Math.max(0, Date.parse(earlierTask.endTime) - Date.parse(earlierTask.startTime))
              : null
            if (!earlierTask.detailUrl) earlierTask.detailUrl = task.detailUrl ?? null
          } else existing.tasks.push(task)
          if (status === 'failed') existing.status = 'failed'
          else if (status === 'running' && existing.status !== 'failed') existing.status = 'running'
          if (startTime < existing.startTime) existing.startTime = startTime
          if (endTime && (!existing.endTime || endTime > existing.endTime))
            existing.endTime = endTime
        } else {
          groups.set(sessionId, {
            id: sessionId,
            sessionId,
            name: asString(metadata?.sessionName) || task.name,
            startTime,
            ...(endTime ? { endTime } : {}),
            status,
            durationMs: task.durationMs,
            detailUrl,
            tasks: [task]
          })
        }
      }
    } catch {
      throw new Error('LangSmith model log query failed; check endpoint, project and API key')
    }
    return [...groups.values()]
      .map((session) => {
        session.tasks.sort((a, b) => a.startTime.localeCompare(b.startTime))
        session.detailUrl = session.tasks.find((task) => task.detailUrl)?.detailUrl ?? null
        session.durationMs = session.endTime
          ? Math.max(0, Date.parse(session.endTime) - Date.parse(session.startTime))
          : null
        return session
      })
      .filter((session) => {
        if (query.status && session.status !== query.status) return false
        const search = query.query?.trim().toLowerCase()
        return (
          !search ||
          [
            session.name,
            session.sessionId,
            ...session.tasks.flatMap((task) => [task.name, task.model.modelId])
          ].some((value) => value.toLowerCase().includes(search))
        )
      })
      .sort((a, b) => b.startTime.localeCompare(a.startTime))
  }

  private detailUrl(path: string | undefined): string | null {
    if (!path) return null
    try {
      const url = new URL(path, this.webOrigin)
      if (
        url.protocol !== 'https:' ||
        url.origin !== this.webOrigin ||
        url.username ||
        url.password
      )
        return null
      return url.href
    } catch {
      return null
    }
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
function asDate(value: unknown): string {
  return new Date(value as string).toISOString()
}
function sanitizeText(value: string, apiKey: string): string {
  const withoutKnownKey = apiKey ? value.replaceAll(apiKey, '[redacted]') : value
  return withoutKnownKey.replace(/Bearer\s+[^\s]+|sk-[A-Za-z0-9_-]+/gi, '[redacted]')
}
function sanitize(value: unknown, apiKey: string): unknown {
  if (typeof value === 'string') return sanitizeText(value, apiKey)
  if (Array.isArray(value)) return value.map((item) => sanitize(item, apiKey))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nested]) =>
      /^(api[-_]?key|authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|x[-_]?api[-_]?key|session[-_]?token)$/i.test(
        key
      )
        ? []
        : [[key, sanitize(nested, apiKey)]]
    )
  )
}
