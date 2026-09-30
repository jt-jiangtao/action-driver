import type {
  AppApprovalDecision,
  RecentTaskProjection,
  SessionCatalogPageProjection,
  SkillControlCommand,
  SkillExecutionEvent,
  TaskProjection
} from '@action-driver/contracts'
import type { AgentDesktopApi } from '../../../../preload/desktop-api'
import type { RuntimeHttpClient } from '../transport/runtime-http-client'

export type AgentControlApi = Pick<
  AgentDesktopApi,
  | 'get'
  | 'listTasks'
  | 'interrupt'
  | 'continue'
  | 'provideInput'
  | 'controlSkill'
  | 'decideAppApproval'
> & {
  listSessions?(
    archived: boolean,
    query?: string,
    cursor?: string | null,
    limit?: number
  ): Promise<SessionCatalogPageProjection>
  setSessionPinned?(sessionId: string, value: boolean): Promise<void>
  setSessionArchived?(sessionId: string, value: boolean): Promise<void>
  /** Persisted "always allow" Computer Use grants, managed from the settings page. */
  listAlwaysAllowedApps?(): Promise<string[]>
  removeAlwaysAllowedApp?(bundleId: string): Promise<string[]>
}

export class RuntimeAgentHttpApi implements AgentControlApi {
  constructor(private readonly http: RuntimeHttpClient) {}

  async get(taskId: string): Promise<TaskProjection | null> {
    const result = await this.http.request<{ task: TaskProjection | null }>(
      `/tasks/${encodeURIComponent(taskId)}`
    )
    return result.task
  }

  async listTasks(limit = 20): Promise<RecentTaskProjection[]> {
    const result = await this.http.request<{ tasks: RecentTaskProjection[] }>(
      `/tasks?limit=${encodeURIComponent(limit)}`
    )
    return result.tasks
  }

  async listSessions(
    archived: boolean,
    query = '',
    cursor?: string | null,
    limit = 50
  ): Promise<SessionCatalogPageProjection> {
    const params = new URLSearchParams({ archived: String(archived), query, limit: String(limit) })
    if (cursor) params.set('cursor', cursor)
    return this.http.request<SessionCatalogPageProjection>(`/sessions/catalog?${params}`)
  }

  async setSessionPinned(sessionId: string, value: boolean): Promise<void> {
    await this.http.request(`/sessions/${encodeURIComponent(sessionId)}/pin`, {
      method: 'PUT',
      body: { value }
    })
  }

  async setSessionArchived(sessionId: string, value: boolean): Promise<void> {
    await this.http.request(`/sessions/${encodeURIComponent(sessionId)}/archive`, {
      method: 'PUT',
      body: { value }
    })
  }

  async listAlwaysAllowedApps(): Promise<string[]> {
    const result = await this.http.request<{ bundleIds: string[] }>('/computer-use/always-allowed')
    return result.bundleIds
  }

  async removeAlwaysAllowedApp(bundleId: string): Promise<string[]> {
    const result = await this.http.request<{ bundleIds: string[] }>(
      '/computer-use/always-allowed/remove',
      { method: 'POST', body: { bundleId } }
    )
    return result.bundleIds
  }

  async interrupt(taskId: string): Promise<void> {
    await this.http.request(`/tasks/${encodeURIComponent(taskId)}/interrupt`, { method: 'POST' })
  }

  async continue(taskId: string): Promise<void> {
    await this.http.request(`/tasks/${encodeURIComponent(taskId)}/continue`, { method: 'POST' })
  }

  async provideInput(taskId: string, value: unknown): Promise<void> {
    await this.http.request(`/tasks/${encodeURIComponent(taskId)}/input`, {
      method: 'POST',
      body: { value }
    })
  }

  async decideAppApproval(
    taskId: string,
    requestId: string,
    decision: AppApprovalDecision
  ): Promise<void> {
    await this.http.request(
      `/tasks/${encodeURIComponent(taskId)}/app-approvals/${encodeURIComponent(requestId)}/decision`,
      {
        method: 'POST',
        body: { decision }
      }
    )
  }

  async controlSkill(
    invocationId: string,
    command: SkillControlCommand
  ): Promise<SkillExecutionEvent> {
    const result = await this.http.request<{ event: SkillExecutionEvent }>(
      `/skills/invocations/${encodeURIComponent(invocationId)}/control`,
      { method: 'POST', body: { command } }
    )
    return result.event
  }
}
