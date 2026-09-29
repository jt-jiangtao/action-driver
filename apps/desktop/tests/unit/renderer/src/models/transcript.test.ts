import type {
  AgentMessageProjection,
  MessageContentPart,
  TaskProjection,
  ToolInvocationProjection
} from '@actiondriver/contracts'
import { describe, expect, it } from 'vitest'
import {
  selectActivityItems,
  selectPriorTurns,
  selectTranscript,
  selectVisibleAssistantMessages
} from '../../../../../src/renderer/src/models/transcript'
import { planMessageMedia } from '../../../../../src/renderer/src/models/message-media'

const imageTool = (overrides: Partial<ToolInvocationProjection> = {}): ToolInvocationProjection => ({
  callId: 'call-1',
  toolId: 'tools/local/image-generation/generate',
  modelName: 'tools_local_image_generation_generate',
  summary: '生成图片',
  argumentsHash: '',
  imageCount: 1,
  status: 'running',
  ...overrides
})

const task = (overrides: Partial<TaskProjection> = {}): TaskProjection => ({
  id: 'task-1',
  sessionId: 'session-1',
  title: '任务',
  status: 'running',
  model: { connectionId: 'connection-1', modelId: 'model-1' },
  messages: [
    { id: 'user-1', role: 'user', content: '画图' },
    { id: 'agent-1', role: 'agent', content: '' }
  ],
  steps: [{ id: 'agent', title: 'Agent', detail: '执行中', state: 'current' }],
  browser: null,
  ...overrides
})

const batch: MessageContentPart = { kind: 'image-batch', callId: 'call-1', imageCount: 1 }
const image: MessageContentPart = {
  kind: 'image',
  asset: {
    assetId: 'asset-1',
    sessionId: 'session-1',
    mimeType: 'image/png',
    width: 1,
    height: 1,
    byteLength: 20,
    source: 'generated'
  },
  generation: { callId: 'call-1', index: 0 }
}

describe('transcript selection', () => {
  it('orders the current turn and lets the activity area own process text', () => {
    const entries = selectTranscript(
      task({
        messages: [
          { id: 'user-1', role: 'user', content: '画图' },
          {
            id: 'agent-1',
            role: 'agent',
            content: '过程答案',
            parts: [
              { kind: 'text', text: '过程', order: 0 },
              { kind: 'activity', activityId: 'research', order: 1 },
              { kind: 'text', text: '答案', order: 2 }
            ]
          }
        ],
        activityTimeline: [
          { id: 'text:process', kind: 'text', content: '过程', phase: 'process' },
          { id: 'activity:research', kind: 'activity', activityId: 'research' }
        ],
        activities: [
          { activityId: 'research', title: '调研', titleRevision: 1, status: 'completed', items: [] }
        ],
        pendingAppApproval: [],
        outputFiles: []
      })
    )
    expect(entries.map((entry) => entry.kind)).toEqual(['user', 'activity', 'assistant', 'output-files'])
    const activity = entries.find((entry) => entry.kind === 'activity')
    expect(activity?.kind === 'activity' ? activity.items : []).toEqual([
      { kind: 'text', id: 'text:process', content: '过程' },
      { kind: 'activity', id: 'activity:research', activityId: 'research' }
    ])
    const assistant = entries.find((entry) => entry.kind === 'assistant')
    expect(assistant?.kind === 'assistant' ? assistant.message.content : '').toBe('答案')
  })

  it('keeps the mirrored layout for transcripts without order information', () => {
    const mirrored = task({
      messages: [
        { id: 'user-1', role: 'user', content: '测试' },
        { id: 'agent-1', role: 'agent', content: '好的，我来测试' }
      ],
      activityTimeline: [
        { id: 'text:plan', kind: 'text', content: '好的，我来测试', phase: 'process' }
      ]
    })
    expect(selectVisibleAssistantMessages(mirrored)).toEqual([])
    expect(selectActivityItems(mirrored)).toEqual([
      { kind: 'text', id: 'text:plan', content: '好的，我来测试' }
    ])
  })

  it('drops the mirrored prefix once the turn is ordered', () => {
    const ordered = task({
      messages: [
        { id: 'user-1', role: 'user', content: '测试' },
        {
          id: 'agent-1',
          role: 'agent',
          content: '过程答案',
          parts: [
            { kind: 'text', text: '过程', order: 0 },
            { kind: 'text', text: '答案', order: 1 }
          ]
        }
      ],
      activityTimeline: [{ id: 'text:plan', kind: 'text', content: '过程', phase: 'process' }]
    })
    const visible = selectVisibleAssistantMessages(ordered)
    expect(visible).toHaveLength(1)
    expect(visible[0]?.content).toBe('答案')
    expect(visible[0]?.parts).toEqual([{ kind: 'text', text: '答案', order: 1 }])
  })

  it('keeps only deliverable content and reports the failure detail', () => {
    const failed = task({
      status: 'failed',
      messages: [
        { id: 'user-1', role: 'user', content: '画图' },
        { id: 'agent-1', role: 'agent', content: '过程文字', parts: [batch, image] }
      ],
      steps: [{ id: 'agent', title: 'Agent', detail: '模型响应失败', state: 'failed' }]
    })
    const visible = selectVisibleAssistantMessages(failed)
    expect(visible).toHaveLength(1)
    expect(visible[0]?.content).toBe('')
    expect(visible[0]?.parts).toEqual([batch, image])
    const failure = selectTranscript(failed).find((entry) => entry.kind === 'failure')
    expect(failure?.kind === 'failure' ? failure.detail : '').toBe('模型响应失败')
  })

  it('serves finished turns from the identity cache while the current turn streams', () => {
    const history: AgentMessageProjection[] = [
      { id: 'user-1', role: 'user', content: '第一轮' },
      { id: 'agent-1', role: 'agent', content: '回答一' },
      { id: 'user-2', role: 'user', content: '继续' }
    ]
    const first = task({ messages: [...history, { id: 'agent-2', role: 'agent', content: '' }] })
    const turns = selectPriorTurns(first)
    expect(turns).toHaveLength(1)
    expect(turns[0]?.user.id).toBe('user-1')
    expect(turns[0]?.replies.map((reply) => reply.id)).toEqual(['agent-1'])

    const streamed = task({
      messages: [...history, { id: 'agent-2', role: 'agent', content: '流式片段' }]
    })
    expect(selectPriorTurns(streamed)).toBe(turns)
  })

  it('carries approvals and output files at their own positions', () => {
    const request = {
      requestId: 'approval-1',
      taskId: 'task-1',
      sessionId: 'session-1',
      target: {
        bundleId: 'com.apple.Notes',
        displayName: 'Notes',
        appPath: '/System/Applications/Notes.app',
        risk: 'low' as const
      },
      allowPersistentApproval: true
    }
    const files: NonNullable<TaskProjection['outputFiles']> = [
      {
        fileId: 'file-1',
        sessionId: 'session-1',
        taskId: 'task-1',
        name: 'report.md',
        mimeType: 'text/markdown',
        byteLength: 10,
        kind: 'document'
      }
    ]
    const entries = selectTranscript(task({ pendingAppApproval: [request], outputFiles: files }))
    expect(entries.map((entry) => entry.kind)).toEqual([
      'user',
      'activity',
      'approval',
      'output-files'
    ])
  })
})

describe('message media plan', () => {
  it('anchors each batch gallery at its own call and keeps pending batches last', () => {
    const message: AgentMessageProjection = {
      id: 'agent-1',
      role: 'agent',
      content: '过程答案',
      parts: [
        { kind: 'text', text: '过程', order: 0 },
        { kind: 'image-batch', callId: 'call-1', imageCount: 1, order: 1 },
        { kind: 'text', text: '答案', order: 2 }
      ]
    }
    const plan = planMessageMedia(message, [
      imageTool(),
      imageTool({ callId: 'call-2', status: 'running' })
    ])
    expect(plan.hasMedia).toBe(true)
    expect(plan.blocks.map((block) => block.key)).toEqual(['text-0', 'batch-call-1', 'text-2', 'pending-batches'])
    expect(plan.blocks[1]).toMatchObject({ kind: 'gallery', images: [], tools: [{ callId: 'call-1' }] })
  })

  it('keeps an unanchored image in its own place and skips text-only messages', () => {
    const unanchored = planMessageMedia(
      { id: 'agent-1', role: 'agent', content: '', parts: [image] },
      []
    )
    expect(unanchored.hasMedia).toBe(true)
    expect(unanchored.blocks).toEqual([
      { kind: 'gallery', key: 'image-0', images: [image], tools: [] }
    ])
    const plain = planMessageMedia({ id: 'agent-2', role: 'agent', content: '只有文字' }, [])
    expect(plain.hasMedia).toBe(false)
  })
})
