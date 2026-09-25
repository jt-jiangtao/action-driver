import type { AgentMessageProjection, MessageContentPart } from '@actiondriver/contracts'
import { describe, expect, it } from 'vitest'
import { dedupeAssistantText, activityOwnedText } from './activity-mirror'

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

const message = (
  content: string,
  parts?: MessageContentPart[]
): AgentMessageProjection => ({ id: 'assistant-1', role: 'agent', content, ...(parts ? { parts } : {}) })

describe('activity mirror de-duplication', () => {
  it('keeps the streamed text out of the message while the mirror lags one delta', () => {
    const parts: MessageContentPart[] = [
      { kind: 'text', text: '过程一' },
      batch,
      image,
      { kind: 'text', text: '过程二' }
    ]
    // The activity channel leads the answer channel by one delta, so equality
    // must never decide: the whole message text is already on screen upstairs.
    const mirrorAhead = dedupeAssistantText(message('过程一过程二', parts), '过程一过程二好')
    expect(mirrorAhead.parts).toEqual([batch, image])
    expect(mirrorAhead.content).toBe('')

    // Equal lengths are the same case, one event earlier or later.
    const mirrored = dedupeAssistantText(message('过程一过程二', parts), '过程一过程二')
    expect(mirrored.parts).toEqual([batch, image])

    // A trailing channel keeps only the deltas the activity area has not shown
    // yet, so no streamed text is ever lost from the screen.
    const answerAhead = dedupeAssistantText(message('过程一过程二', parts), '过程一过')
    expect(answerAhead.parts).toEqual([batch, image, { kind: 'text', text: '程二' }])
  })

  it('keeps only the answer once the activity area stops showing the final text', () => {
    const deduped = dedupeAssistantText(
      message('过程一答案', [
        { kind: 'text', text: '过程一' },
        batch,
        image,
        { kind: 'text', text: '答案' }
      ]),
      '过程一'
    )
    expect(deduped.parts).toEqual([batch, image, { kind: 'text', text: '答案' }])
    expect(deduped.content).toBe('答案')
  })

  it('derives the visible text from the parts when the terminal content differs', () => {
    // The runtime keeps a turn's answer in `content` while the parts hold the
    // whole transcript, so the remainder must come from the parts.
    const deduped = dedupeAssistantText(
      message('答案', [
        { kind: 'text', text: '过程一' },
        batch,
        image,
        { kind: 'text', text: '答案' }
      ]),
      '过程一'
    )
    expect(deduped.parts).toEqual([batch, image, { kind: 'text', text: '答案' }])
    expect(deduped.content).toBe('答案')
  })

  it('leaves text alone when it does not mirror the activity area', () => {
    const untouched = dedupeAssistantText(message('完全不同的内容'), '过程一')
    expect(untouched.content).toBe('完全不同的内容')
  })

  it('drops only the mirrored prefix from a text-only message', () => {
    const deduped = dedupeAssistantText(message('过程一答案'), '过程一')
    expect(deduped.content).toBe('答案')
  })
})

describe('activityOwnedText', () => {
  it('owns the process narration an ordered turn closed before more work', () => {
    const task = {
      status: 'running' as const,
      activityTimeline: [
        { id: 'text:plan:1', kind: 'text' as const, content: '过程一', phase: 'process' as const },
        { id: 'activity:tools', kind: 'activity' as const, activityId: 'activity:tools' },
        { id: 'text:plan:2', kind: 'text' as const, content: '过程二', phase: 'process' as const },
        { id: 'text:plan:3', kind: 'text' as const, content: '答案', phase: 'final' as const }
      ],
      messages: [
        {
          id: 'assistant-1',
          role: 'agent' as const,
          content: '过程一过程二答案',
          parts: [
            { kind: 'text' as const, text: '过程一', order: 1 },
            { kind: 'activity' as const, activityId: 'activity:tools', order: 2 },
            { kind: 'text' as const, text: '过程二', order: 4 },
            { kind: 'text' as const, text: '答案', order: 5 }
          ]
        }
      ]
    }
    // Process narration belongs to the activity area, the answer stays in the
    // transcript, and pending text is never taken away from it.
    expect(activityOwnedText(task)).toBe('过程一过程二')
    expect(activityOwnedText({ ...task, status: 'succeeded' })).toBe('过程一过程二')
  })

  it('keeps a pending answer in the transcript so it never jumps', () => {
    const task = {
      status: 'running' as const,
      activityTimeline: [
        { id: 'activity:tools', kind: 'activity' as const, activityId: 'activity:tools' },
        { id: 'text:plan:2', kind: 'text' as const, content: '答案', phase: 'pending' as const }
      ],
      messages: [
        {
          id: 'assistant-1',
          role: 'agent' as const,
          content: '过程一答案',
          parts: [
            { kind: 'text' as const, text: '过程一', order: 1 },
            { kind: 'activity' as const, activityId: 'activity:tools', order: 2 },
            { kind: 'text' as const, text: '答案', order: 4 }
          ]
        }
      ]
    }
    expect(activityOwnedText(task)).toBe('')
  })

  it('keeps the legacy mirrored layout for transcripts without order', () => {
    const timeline = [
      { id: 'text:plan:1', kind: 'text' as const, content: '过程一', phase: 'process' as const },
      { id: 'text:plan:2', kind: 'text' as const, content: '答案', phase: 'final' as const }
    ]
    expect(activityOwnedText({ status: 'running', activityTimeline: timeline })).toBe('过程一答案')
    expect(activityOwnedText({ status: 'succeeded', activityTimeline: timeline })).toBe('过程一')
  })
})
