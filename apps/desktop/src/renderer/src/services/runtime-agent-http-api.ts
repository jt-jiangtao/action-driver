import type {
  RecentTaskProjection, SkillControlCommand, SkillExecutionEvent, TaskProjection
} from '@actiondriver/contracts'
import type { AgentDesktopApi } from '../../../preload/desktop-api'
import type { RuntimeHttpClient } from './runtime-http-client'

export type AgentControlApi = Pick<AgentDesktopApi,
  'get' | 'listTasks' | 'interrupt' | 'continue' | 'provideInput' | 'controlSkill'
>

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

  async interrupt(taskId: string): Promise<void> {
    await this.http.request(`/tasks/${encodeURIComponent(taskId)}/interrupt`, { method: 'POST' })
  }

  async continue(taskId: string): Promise<void> {
    await this.http.request(`/tasks/${encodeURIComponent(taskId)}/continue`, { method: 'POST' })
  }

  async provideInput(taskId: string, value: unknown): Promise<void> {
    await this.http.request(`/tasks/${encodeURIComponent(taskId)}/input`, {
      method: 'POST', body: { value }
    })
  }

  async controlSkill(invocationId: string, command: SkillControlCommand): Promise<SkillExecutionEvent> {
    const result = await this.http.request<{ event: SkillExecutionEvent }>(
      `/skills/invocations/${encodeURIComponent(invocationId)}/control`,
      { method: 'POST', body: { command } }
    )
    return result.event
  }
}
