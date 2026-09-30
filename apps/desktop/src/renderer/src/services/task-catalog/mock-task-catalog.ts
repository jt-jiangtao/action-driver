import type { TaskProjection } from '@action-driver/contracts'
import type { RecentTaskSummary, TaskCatalog } from '../../models/task-catalog'
import { mockBrowserSkillProjection } from './mock-task-fixture'

type TaskSeed = {
  id: string
  title: string
  goal: string
  response: string
  currentStep: string
  browserTitle: string
  browserUrl: string
  state: RecentTaskSummary['state']
}

const seeds: readonly TaskSeed[] = [
  {
    id: 'hotel-task',
    title: '预订周末去杭州的酒店',
    goal: '帮我预订本周六到周日，杭州西湖附近评分 4.5 以上的酒店。',
    response: '我会在内嵌浏览器中查找符合条件的酒店，并在提交预订前请你确认。',
    currentStep: '填写入住日期',
    browserTitle: '杭州酒店 · 携程旅行',
    browserUrl: 'https://hotels.ctrip.com/hotels/list',
    state: 'loading'
  },
  {
    id: 'research-task',
    title: '整理产品研究资料',
    goal: '整理近期收集的产品研究资料，按主题归类并提取关键结论。',
    response: '我会梳理资料来源、合并重复观点，并输出可追踪的主题摘要。',
    currentStep: '归纳关键洞察',
    browserTitle: '产品研究资料库',
    browserUrl: 'https://example.com/research',
    state: 'default'
  },
  {
    id: 'monitor-task',
    title: '比较三款显示器',
    goal: '比较三款 27 英寸 4K 显示器的色彩、接口与价格。',
    response: '我会统一规格口径，并把差异整理成便于决策的比较表。',
    currentStep: '核对接口规格',
    browserTitle: '显示器参数比较',
    browserUrl: 'https://example.com/monitors',
    state: 'default'
  },
  {
    id: 'travel-list-task',
    title: '更新旅行清单',
    goal: '根据下周天气更新旅行清单，补充雨具和常用药品。',
    response: '我会核对天气与行程，再更新需要携带和可删除的物品。',
    currentStep: '检查目的地天气',
    browserTitle: '旅行清单',
    browserUrl: 'https://example.com/travel-list',
    state: 'default'
  },
  {
    id: 'meeting-summary-task',
    title: '汇总本周会议记录',
    goal: '汇总本周会议记录，提取决策、负责人和截止时间。',
    response: '我会按会议合并行动项，并标记缺少负责人或日期的内容。',
    currentStep: '提取行动项',
    browserTitle: '会议记录',
    browserUrl: 'https://example.com/meetings',
    state: 'default'
  }
]

function createProjection(seed: TaskSeed): TaskProjection {
  return {
    id: seed.id,
    sessionId: `${seed.id}-session`,
    title: seed.title,
    status: 'running',
    model: { connectionId: 'company-gateway', modelId: 'gpt-5.2' },
    messages: [
      { id: `${seed.id}-user`, role: 'user', content: seed.goal },
      { id: `${seed.id}-agent`, role: 'agent', content: seed.response }
    ],
    steps: [
      {
        id: `${seed.id}-observe`,
        title: '观察资料',
        detail: '已识别任务输入与可用来源',
        state: 'success'
      },
      {
        id: `${seed.id}-plan`,
        title: '制定计划',
        detail: '已确定处理顺序和验收条件',
        state: 'success'
      },
      {
        id: `${seed.id}-current`,
        title: seed.currentStep,
        detail: '正在执行当前步骤',
        state: 'current'
      },
      {
        id: `${seed.id}-confirm`,
        title: '等待用户确认',
        detail: '提交最终结果前请求确认',
        state: 'waiting'
      }
    ],
    browser: {
      ...mockBrowserSkillProjection,
      title: seed.browserTitle,
      url: seed.browserUrl,
      target: null
    }
  }
}

export class MockTaskCatalog implements TaskCatalog {
  private readonly tasks = new Map(seeds.map((seed) => [seed.id, createProjection(seed)]))

  async listRecentTasks(): Promise<readonly RecentTaskSummary[]> {
    return seeds.map(({ id, title, state }) => ({ id, title, state }))
  }

  async getTask(taskId: string): Promise<TaskProjection | null> {
    const task = this.tasks.get(taskId)
    return task ? structuredClone(task) : null
  }
}
