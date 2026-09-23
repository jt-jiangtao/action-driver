import type { ModelLogSessionProjection } from '@actiondriver/contracts'
import type { AgentDesktopApi } from '../../../preload/desktop-api'
import type { ModelLogService } from '../models/model-log-service'
import { mockModelLogSessions, type ModelLogSession } from '../models/model-logs'

export class DesktopModelLogService implements ModelLogService {
  constructor(private readonly api: AgentDesktopApi) {}

  async list(): Promise<ModelLogSession[]> {
    return (await this.api.listModelLogs()).map(toModelLogSession)
  }
}

export class MockModelLogService implements ModelLogService {
  async list(): Promise<ModelLogSession[]> {
    return structuredClone(mockModelLogSessions)
  }
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
    tasks: session.tasks.map((task) => ({
      id: task.id,
      name: task.name,
      startTime: displayTime(task.startTime),
      status: task.status,
      duration: displayDuration(task.durationMs, task.status),
      model: task.model.modelId,
      calls: task.calls.map((call) => ({
        id: call.id,
        label: call.label,
        time: displayTime(call.time),
        kind: 'model',
        status: call.status,
        description: call.description,
        sections: call.sections
      }))
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
