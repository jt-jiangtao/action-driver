import type {
  AgentCommandService,
  AgentGoalRequest,
  AgentSessionRepository,
  SkillExecutionEvent,
  SkillGateway,
  TaskProjection
} from '@action-driver/contracts'
import { SKILL_IDS } from '@action-driver/contracts'
import { mockBrowserSkillProjection } from '../task-catalog/mock-task-fixture'

const BROWSER_INVOCATION_ID = 'browser-invocation'

const initialTask = (
  goal: string,
  id = 'hotel-task',
  sessionId = 'hotel-session',
  messages?: TaskProjection['messages']
): TaskProjection => ({
  id,
  sessionId,
  title: '预订周末去杭州的酒店',
  status: 'running',
  model: { connectionId: 'company-gateway', modelId: 'gpt-5.2' },
  messages: messages ?? [
    { id: 'message-user', role: 'user', content: goal },
    {
      id: 'message-agent',
      role: 'agent',
      content: '我会在内嵌浏览器中查找符合条件的酒店，并在提交预订前请你确认。'
    }
  ],
  steps: [
    { id: 'observe', title: '观察页面', detail: '已识别酒店列表与筛选条件', state: 'success' },
    { id: 'open', title: '打开酒店列表', detail: '已进入杭州酒店结果页', state: 'success' },
    {
      id: 'dates',
      title: '填写入住日期',
      detail: '选择 4 月 12 日至 4 月 13 日',
      state: 'current'
    },
    { id: 'confirm', title: '等待用户确认', detail: '提交前请求确认', state: 'waiting' }
  ],
  browser: structuredClone(mockBrowserSkillProjection)
})

export class MockAgentSessionService implements AgentCommandService, AgentSessionRepository {
  private task = initialTask('帮我预订本周六到周日，杭州西湖附近评分 4.5 以上的酒店。')
  private readonly listeners = new Set<(task: TaskProjection) => void>()
  private turn = 1

  constructor(private readonly skillGateway: SkillGateway) {
    this.skillGateway.subscribe((event) => this.applySkillEvent(event))
    void this.skillGateway.invoke({
      id: BROWSER_INVOCATION_ID,
      taskId: this.task.id,
      skillId: SKILL_IDS.browser,
      input: { action: 'open-url', url: this.task.browser?.url ?? 'about:blank' }
    })
  }

  async submitGoal(request: AgentGoalRequest): Promise<TaskProjection> {
    if ('sessionId' in request) {
      this.turn += 1
      this.task = initialTask(request.goal, `hotel-task-${this.turn}`, request.sessionId, [
        ...this.task.messages,
        { id: `message-user-${this.turn}`, role: 'user', content: request.goal },
        {
          id: `message-agent-${this.turn}`,
          role: 'agent',
          content: '我会继续处理这个会话。'
        }
      ])
    } else {
      this.task = {
        ...initialTask(request.goal),
        model: request.model
      }
    }
    await this.skillGateway.invoke({
      id: BROWSER_INVOCATION_ID,
      taskId: this.task.id,
      skillId: SKILL_IDS.browser,
      input: { action: 'open-url', url: this.task.browser?.url ?? 'about:blank' }
    })
    this.emit()
    return structuredClone(this.task)
  }
  async interrupt(taskId: string): Promise<void> {
    if (taskId !== this.task.id) return
    this.task = this.withSkillState('failed')
    this.emit()
  }
  async continueTask(taskId: string): Promise<void> {
    if (taskId !== this.task.id || !this.task.browser) return
    await this.skillGateway.resume(BROWSER_INVOCATION_ID)
  }
  async provideInput(_taskId: string, _value: unknown): Promise<void> { }
  async decideAppApproval(): Promise<void> { }
  getTask(taskId: string): TaskProjection | null {
    return taskId === this.task.id ? structuredClone(this.task) : null
  }
  subscribe(listener: (task: TaskProjection) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private withSkillState(state: TaskProjection['status']): TaskProjection {
    const steps = this.task.steps.map((step) => {
      if (state === 'succeeded') return { ...step, state: 'success' as const }
      if (state === 'failed' && step.state === 'current') {
        return { ...step, state: 'failed' as const, detail: '任务已中断' }
      }
      return step
    })
    return {
      ...this.task,
      status: state,
      steps,
      browser: this.task.browser ? { ...this.task.browser, status: state } : null
    }
  }

  private applySkillEvent(event: SkillExecutionEvent): void {
    if (event.skillId !== SKILL_IDS.browser || event.invocationId !== BROWSER_INVOCATION_ID) return
    this.task = this.withSkillState(event.state)
    this.emit()
  }

  private emit(): void {
    const projection = structuredClone(this.task)
    this.listeners.forEach((listener) => listener(projection))
  }
}
