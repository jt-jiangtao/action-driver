import type { ModelLogSessionProjection } from '@actiondriver/contracts'
import type { ModelLogService } from '../models/model-log-service'
import type { ModelLogSession } from '../models/model-logs'

export type LegacyModelLogApi = {
  listModelLogs(): Promise<ModelLogSessionProjection[]>
  openModelLogDetail(url: string, bounds: Parameters<ModelLogService['openDetail']>[1]): Promise<void>
  setModelLogDetailBounds(bounds: Parameters<ModelLogService['setDetailBounds']>[0]): Promise<void>
  closeModelLogDetail(): Promise<void>
}

export class DesktopModelLogService implements ModelLogService {
  constructor(private readonly api: LegacyModelLogApi) {}

  async list(): Promise<ModelLogSession[]> {
    return (await this.api.listModelLogs()).map(toModelLogSession)
  }

  async openDetail(
    url: string,
    bounds: Parameters<ModelLogService['openDetail']>[1]
  ): Promise<void> {
    await this.api.openModelLogDetail(url, bounds)
  }
  async setDetailBounds(bounds: Parameters<ModelLogService['setDetailBounds']>[0]): Promise<void> {
    await this.api.setModelLogDetailBounds(bounds)
  }
  async closeDetail(): Promise<void> {
    await this.api.closeModelLogDetail()
  }
}

export class MockModelLogService implements ModelLogService {
  async list(): Promise<ModelLogSession[]> {
    return []
  }

  async openDetail(): Promise<void> {
    throw new Error('LangSmith is unavailable in mock mode')
  }
  async setDetailBounds(): Promise<void> {}
  async closeDetail(): Promise<void> {}
}

export function toModelLogSession(session: ModelLogSessionProjection): ModelLogSession {
  return {
    id: session.id,
    sessionId: session.sessionId,
    name: session.name,
    startTime: displayTime(session.startTime),
    ...(session.endTime ? { endTime: displayTime(session.endTime) } : {}),
    status: session.status,
    duration: displayDuration(session.durationMs, session.status),
    detailUrl: session.detailUrl ?? null,
    tasks: session.tasks.map((task) => ({
      id: task.id,
      name: task.name,
      startTime: displayTime(task.startTime),
      status: task.status,
      duration: displayDuration(task.durationMs, task.status),
      model: task.model.modelId,
      detailUrl: task.detailUrl ?? null,
      calls: []
    }))
  }
}

function displayDuration(durationMs: number | null, status: ModelLogSession['status']): string {
  if (durationMs === null) return status === 'running' ? '进行中' : '—'
  const seconds = Math.max(0, Math.round(durationMs / 1_000))
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

function displayTime(value: string): string {
  return value.replace('T', ' ').replace(/\.\d{3}Z$/, '')
}
