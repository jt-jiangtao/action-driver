import { describe, expect, it } from 'vitest'
import {
  IMAGE_GENERATION_TOOL_ID,
  SKILL_IDS,
  hasImageGenerationGallery,
  imageGenerationSlotCount,
  isImageGenerationRunning,
  isSerializableContract,
  normalizeAssistantParts,
  type BrowserSkillInvocation,
  type ComputerUseSkillInvocation,
  type BrowserSkillProjection,
  type AgentGoalRequest,
  type RecentTaskProjection,
  type SkillExecutionEvent,
  type TaskProjection,
  type ToolInvocationProjection
} from '../../src/index'

const imageTool = (overrides: Partial<ToolInvocationProjection> = {}): ToolInvocationProjection => ({
  callId: 'call-1',
  toolId: IMAGE_GENERATION_TOOL_ID,
  modelName: 'tools_local_image_generation_generate',
  summary: '生成图片',
  argumentsHash: 'hash',
  imageCount: 2,
  status: 'running' as const,
  ...overrides
})

describe('image generation tool projection', () => {
  it('reserves slots for its own tool id only', () => {
    expect(imageGenerationSlotCount(imageTool())).toBe(2)
    expect(imageGenerationSlotCount(imageTool({ toolId: 'shell' }))).toBe(0)
    const withoutSlots: ToolInvocationProjection = { ...imageTool() }
    delete withoutSlots.imageCount
    expect(imageGenerationSlotCount(withoutSlots)).toBe(0)
  })

  it('renders a gallery once the call leaves its pending statuses', () => {
    expect(hasImageGenerationGallery(imageTool({ status: 'queued' }))).toBe(false)
    expect(hasImageGenerationGallery(imageTool({ status: 'proposed' }))).toBe(false)
    expect(hasImageGenerationGallery(imageTool({ status: 'waiting_approval' }))).toBe(false)
    expect(hasImageGenerationGallery(imageTool({ status: 'running' }))).toBe(true)
    expect(hasImageGenerationGallery(imageTool({ status: 'completed' }))).toBe(true)
    const withoutSlots: ToolInvocationProjection = { ...imageTool({ status: 'running' }) }
    delete withoutSlots.imageCount
    expect(hasImageGenerationGallery(withoutSlots)).toBe(false)
  })

  it('reports in-flight calls for progress indicators', () => {
    for (const status of ['proposed', 'queued', 'running', 'waiting_approval'] as const) {
      expect(isImageGenerationRunning(imageTool({ status }))).toBe(true)
    }
    expect(isImageGenerationRunning(imageTool({ status: 'completed' }))).toBe(false)
    expect(isImageGenerationRunning(imageTool({ status: 'running', toolId: 'shell' }))).toBe(false)
  })
})

describe('agent skill contracts', () => {
  it('keeps every attached document instead of treating it as a duplicate image', () => {
    const document = (fileId: string) => ({
      fileId,
      sessionId: 'session-1',
      taskId: 'task-1',
      name: `${fileId}.pdf`,
      mimeType: 'application/pdf',
      byteLength: 10
    })
    expect(
      normalizeAssistantParts([
        { kind: 'text', text: '附件' },
        { kind: 'document', file: document('file-1') },
        { kind: 'document', file: document('file-2') }
      ])
    ).toEqual([
      { kind: 'text', text: '附件' },
      { kind: 'document', file: document('file-1') },
      { kind: 'document', file: document('file-2') }
    ])
  })

  it('preserves legacy assistant part order while removing duplicate images', () => {
    const asset = (assetId: string) => ({ assetId, sessionId: 's', mimeType: 'image/png' as const, width: 1, height: 1, byteLength: 1, source: 'generated' as const })
    expect(normalizeAssistantParts([
      { kind: 'image', asset: asset('two'), generation: { callId: 'call', index: 2 } },
      { kind: 'text', text: '前' },
      { kind: 'image', asset: asset('zero'), generation: { callId: 'call', index: 0 } },
      { kind: 'text', text: '后' },
      { kind: 'image', asset: asset('two'), generation: { callId: 'call', index: 2 } }
    ])).toEqual([
      { kind: 'image', asset: asset('two'), generation: { callId: 'call', index: 2 } },
      { kind: 'text', text: '前' },
      { kind: 'image', asset: asset('zero'), generation: { callId: 'call', index: 0 } },
      { kind: 'text', text: '后' }
    ])
  })

  it('keeps text on either side of image batches and deduplicates call slots', () => {
    const asset = (assetId: string) => ({ assetId, sessionId: 's', mimeType: 'image/png' as const, width: 1, height: 1, byteLength: 1, source: 'generated' as const })
    expect(normalizeAssistantParts([
      { kind: 'text', text: '前' },
      { kind: 'image-batch', callId: 'a', imageCount: 2 },
      { kind: 'image', asset: asset('a-1'), generation: { callId: 'a', index: 1 } },
      { kind: 'image-batch', callId: 'b', imageCount: 1 },
      { kind: 'text', text: '后' },
      { kind: 'image', asset: asset('a-0'), generation: { callId: 'a', index: 0 } },
      { kind: 'image', asset: asset('a-1'), generation: { callId: 'a', index: 1 } },
      { kind: 'image-batch', callId: 'a', imageCount: 2 }
    ])).toEqual([
      { kind: 'text', text: '前' },
      { kind: 'image-batch', callId: 'a', imageCount: 2 },
      { kind: 'image', asset: asset('a-1'), generation: { callId: 'a', index: 1 } },
      { kind: 'image-batch', callId: 'b', imageCount: 1 },
      { kind: 'text', text: '后' },
      { kind: 'image', asset: asset('a-0'), generation: { callId: 'a', index: 0 } }
    ])
  })
  it('keeps Browser Use and Computer Use as separate skills', () => {
    expect(SKILL_IDS.browser).not.toBe(SKILL_IDS.computer)
    expect(SKILL_IDS).toEqual({ browser: 'browser-use', computer: 'computer-use' })
  })

  it('uses discriminated inputs for Browser and Computer capability invocations', () => {
    const browserInvocation: BrowserSkillInvocation = {
      id: 'browser-invocation',
      taskId: 'task-1',
      skillId: SKILL_IDS.browser,
      input: { action: 'click', nodeHandle: 'date-picker' }
    }
    const computerInvocation: ComputerUseSkillInvocation = {
      id: 'computer-invocation',
      taskId: 'task-1',
      skillId: SKILL_IDS.computer,
      input: { action: 'activate-app', bundleId: 'com.apple.Safari' }
    }

    expect(browserInvocation.skillId).toBe('browser-use')
    expect(computerInvocation.skillId).toBe('computer-use')
    expect(isSerializableContract(browserInvocation)).toBe(true)
    expect(isSerializableContract(computerInvocation)).toBe(true)
  })

  it('accepts serializable task, skill event, and browser projection data', () => {
    const event: SkillExecutionEvent = {
      id: 'event-1',
      invocationId: 'invocation-1',
      skillId: SKILL_IDS.browser,
      state: 'running',
      occurredAt: '2026-09-20T12:00:00.000Z'
    }
    const browser: BrowserSkillProjection = {
      title: '杭州酒店 · 携程旅行',
      url: 'https://hotels.ctrip.com/hotels/list',
      status: 'running',
      target: { label: '选择入住日期', x: 146, y: 150, width: 220, height: 52 }
    }
    const task: TaskProjection = {
      id: 'task-1',
      sessionId: 'session-1',
      title: '预订周末去杭州的酒店',
      status: 'running',
      model: { connectionId: 'connection-a', modelId: 'shared-model' },
      messages: [],
      steps: [],
      browser
    }

    expect(isSerializableContract(event)).toBe(true)
    expect(isSerializableContract(task)).toBe(true)
    expect(isSerializableContract({ ...event, invalid: () => undefined })).toBe(false)
  })

  it('identifies an Agent model by both connection and model id', () => {
    const request: AgentGoalRequest = {
      goal: '总结本周进展',
      model: { connectionId: 'connection-a', modelId: 'shared-model' }
    }

    expect(request.model).toEqual({ connectionId: 'connection-a', modelId: 'shared-model' })
    expect(isSerializableContract(request)).toBe(true)

    const continuation: AgentGoalRequest = {
      goal: '继续解释',
      sessionId: 'session-1'
    }
    expect(continuation).toEqual({ goal: '继续解释', sessionId: 'session-1' })
    expect(isSerializableContract(continuation)).toBe(true)
  })

  it('keeps recent task data serializable', () => {
    const recent: RecentTaskProjection = {
      id: 'task-1',
      sessionId: 'thread-1',
      title: '总结本周进展',
      status: 'succeeded',
      model: { connectionId: 'connection-a', modelId: 'shared-model' },
      createdAt: '2026-09-23T01:00:00.000Z',
      updatedAt: '2026-09-23T01:00:01.000Z'
    }
    expect(recent).toMatchObject({ id: 'task-1', sessionId: 'thread-1' })
    expect(isSerializableContract(recent)).toBe(true)
  })
})
