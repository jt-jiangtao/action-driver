export type ModelRunStatus = 'completed' | 'running' | 'failed'

export type ModelCallKind = 'prompt' | 'model' | 'component' | 'result'

export interface ModelLogDetailSection {
  id: 'system-prompt' | 'user-input' | 'model-request' | 'tool-io' | 'model-response' | 'metadata'
  title: string
  content: string
  language?: 'json' | 'text'
}

export interface ModelLogCall {
  id: string
  label: string
  time: string
  kind: ModelCallKind
  status: ModelRunStatus
  description: string
  sections: ModelLogDetailSection[]
}

export interface ModelLogTask {
  id: string
  name: string
  startTime: string
  status: ModelRunStatus
  duration: string
  model: string
  detailUrl?: string | null
  calls: ModelLogCall[]
}

export interface ModelLogSession {
  id: string
  sessionId: string
  name: string
  startTime: string
  endTime?: string
  status: ModelRunStatus
  duration: string
  detailUrl?: string | null
  tasks: ModelLogTask[]
}

const systemPrompt = `你是一个专业的日常办公助手，可以帮助用户查询天气、整理会议信息、分析竞品并生成结构化报告。`
const userInput = '查询北京今天的天气，并整理成简洁的通勤提示。'

const sharedSections: ModelLogDetailSection[] = [
  { id: 'system-prompt', title: '系统提示词', content: systemPrompt, language: 'text' },
  { id: 'user-input', title: '用户输入', content: userInput, language: 'text' },
  {
    id: 'model-request',
    title: '模型请求',
    language: 'json',
    content: JSON.stringify(
      {
        model: 'gpt-4o',
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userInput }
        ],
        tools: ['browser.open', 'browser.extract']
      },
      null,
      2
    )
  },
  {
    id: 'tool-io',
    title: '工具输入输出',
    language: 'json',
    content: JSON.stringify(
      {
        component: 'Browser',
        input: { action: 'open', query: '北京 今日天气' },
        output: { status: 'ok', title: '北京天气', temperature: '18–27°C' }
      },
      null,
      2
    )
  },
  {
    id: 'model-response',
    title: '模型返回',
    language: 'text',
    content: '北京今天晴转多云，18–27°C。早晚温差较大，建议携带薄外套，午后注意防晒。'
  },
  {
    id: 'metadata',
    title: '元数据',
    language: 'json',
    content: JSON.stringify(
      { provider: 'OpenAI', promptTokens: 824, completionTokens: 186, totalTokens: 1010 },
      null,
      2
    )
  }
]

function call(
  id: string,
  label: string,
  time: string,
  kind: ModelCallKind,
  description: string,
  sections: ModelLogDetailSection[] = sharedSections
): ModelLogCall {
  return { id, label, time, kind, description, sections, status: 'completed' }
}

const weatherCalls: ModelLogCall[] = [
  call('prepare', '前期相关任务', '10:15:32', 'result', '载入会话上下文和用户偏好'),
  call('system-prompt', 'System Prompt', '10:15:33', 'prompt', '组装系统提示词和安全约束'),
  call('context', '上下文组装', '10:15:34', 'prompt', '合并用户输入与会话上下文'),
  call('model-first', 'OpenAI 模型调用', '10:15:36', 'model', '模型决定调用 Browser 组件'),
  call('browser-open', 'Browser 组件', '10:15:38', 'component', '打开天气查询页', [
    sharedSections[0]!,
    sharedSections[1]!,
    sharedSections[2]!,
    {
      id: 'tool-io',
      title: '工具输入输出',
      language: 'json',
      content: JSON.stringify(
        {
          action: 'browser.open',
          intent: '打开天气查询页',
          url: 'https://weather.example.com/beijing',
          result: { status: 'ok', pageTitle: '北京天气' }
        },
        null,
        2
      )
    },
    sharedSections[4]!,
    sharedSections[5]!
  ]),
  call('browser-return', 'Browser 返回', '10:15:42', 'component', '天气数据返回模型上下文'),
  call('model-second', '第二次模型调用', '10:15:45', 'model', '模型根据组件结果生成通勤建议'),
  call('output', '输出解析', '10:15:48', 'result', '校验并格式化最终答案'),
  call('complete', '任务完成', '10:16:24', 'result', '结果已返回给用户')
]

export const mockModelLogSessions: ModelLogSession[] = [
  {
    id: 'office-assistant',
    sessionId: 'session_7e9b4c2d8f6a4e1a9c3d2b7e5f8a1c0d',
    name: '日常办公助手',
    startTime: '2024-01-20 10:15:32',
    endTime: '2024-01-20 10:19:00',
    status: 'completed',
    duration: '4 分 28 秒',
    tasks: [
      {
        id: 'weather-report',
        name: '天气报告',
        startTime: '10:15:32',
        status: 'completed',
        duration: '52 秒',
        model: 'gpt-4o',
        calls: weatherCalls
      },
      {
        id: 'meeting-notes',
        name: '会议纪要',
        startTime: '10:16:45',
        status: 'completed',
        duration: '1 分 38 秒',
        model: 'claude-3.5-sonnet',
        calls: weatherCalls.slice(0, 6)
      },
      {
        id: 'competitor-analysis',
        name: '竞品分析',
        startTime: '10:18:30',
        status: 'completed',
        duration: '1 分 58 秒',
        model: 'gpt-4o',
        calls: weatherCalls.slice(0, 7)
      }
    ]
  },
  {
    id: 'product-copy',
    sessionId: 'session_3d5f6a7b9e2c4d11a8e6f8d7c2b1a930',
    name: '产品方案撰写',
    startTime: '2024-01-19 16:20:11',
    status: 'running',
    duration: '进行中',
    tasks: [
      {
        id: 'outline',
        name: '生成方案大纲',
        startTime: '16:20:11',
        status: 'completed',
        duration: '44 秒',
        model: 'gpt-4o',
        calls: weatherCalls.slice(0, 5)
      },
      {
        id: 'draft',
        name: '撰写方案正文',
        startTime: '16:21:02',
        status: 'running',
        duration: '进行中',
        model: 'gpt-4o',
        calls: weatherCalls
          .slice(0, 4)
          .map((item, index) => (index === 3 ? { ...item, status: 'running' as const } : item))
      }
    ]
  },
  {
    id: 'technical-research',
    sessionId: 'session_9c1e2f4a6b8d4c0ba7f5e3d2c1b09876',
    name: '技术问题排查',
    startTime: '2024-01-19 11:03:24',
    endTime: '2024-01-19 11:04:36',
    status: 'failed',
    duration: '1 分 12 秒',
    tasks: [
      {
        id: 'diagnose',
        name: '定位连接失败',
        startTime: '11:03:24',
        status: 'failed',
        duration: '1 分 12 秒',
        model: 'claude-3.5-sonnet',
        calls: weatherCalls
          .slice(0, 5)
          .map((item, index) =>
            index === 4
              ? { ...item, status: 'failed' as const, description: '组件连接超时，任务中止' }
              : item
          )
      }
    ]
  }
]
