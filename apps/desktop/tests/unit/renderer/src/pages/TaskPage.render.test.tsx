import type { AgentMessageProjection, TaskProjection } from '@action-driver/contracts'
import type { StreamServerEvent } from '@action-driver/runtime-contracts'
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StreamTaskProjection } from '../../../../../src/renderer/src/services/agent-session/stream-task-projection'
import { mockModelSelection } from '../../../../../src/renderer/src/testing/model-selection-fixture'
import { TaskPage } from '../../../../../src/renderer/src/pages/TaskPage'
import { markdownIt } from '../../../../../src/renderer/src/components/markdown-blocks'
import type * as ComposerModule from '../../../../../src/renderer/src/components/AgentComposer'

const composerRenders = vi.hoisted(() => ({ count: 0 }))

vi.mock('../../../../../src/renderer/src/components/AgentComposer', async (importOriginal) => {
  const original = await importOriginal<typeof ComposerModule>()
  return {
    ...original,
    AgentComposer: (props: Parameters<typeof original.AgentComposer>[0]) => {
      composerRenders.count += 1
      return original.AgentComposer(props)
    }
  }
})

const identity = {
  protocol: 'action-driver.stream.v2' as const,
  requestId: 'request-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  responseId: 'response-1',
  streamId: 'stream-1',
  messageId: 'assistant-current',
  occurredAt: '2026-09-26T00:00:00.000Z'
}

function longTask(): TaskProjection {
  const history: AgentMessageProjection[] = []
  for (let turn = 0; turn < 50; turn += 1) {
    history.push({ id: `user-${turn}`, role: 'user', content: `问题 ${turn}` })
    history.push({ id: `agent-${turn}`, role: 'agent', content: `回答 ${turn}` })
  }
  return {
    id: 'task-1',
    sessionId: 'session-1',
    title: '长对话',
    status: 'running',
    model: { connectionId: 'connection-1', modelId: 'qwen3.7-max' },
    messages: [
      ...history,
      { id: 'user-current', role: 'user', content: '继续' },
      { id: 'assistant-current', role: 'agent', content: '' }
    ],
    steps: [{ id: 'agent', title: 'Agent 执行', detail: 'Agent 正在执行', state: 'current' }],
    browser: null
  }
}

const noop = () => undefined
const pageProps = {
  mode: 'split' as const,
  modelSelection: mockModelSelection,
  onSelectModel: noop,
  onModeChange: noop,
  onPause: noop,
  onResume: noop,
  onTakeOver: noop,
  onInterrupt: noop,
  onSubmit: noop
}

afterEach(() => vi.restoreAllMocks())

describe('TaskPage streaming render cost', () => {
  it('re-renders only the streaming text block while history stays untouched', () => {
    const pending: Array<() => void> = []
    let latest: TaskProjection | null = null
    const projection = new StreamTaskProjection({
      onChange: (task) => {
        latest = task
      },
      schedule: (callback) => pending.push(callback),
      cancelScheduled: () => pending.splice(0)
    })
    projection.attach(longTask())
    const renderBlock = vi.spyOn(markdownIt.renderer, 'render')
    const view = render(<TaskPage {...pageProps} task={projection.snapshot()!} />)
    // The history renders once, when the page mounts.
    const afterMount = renderBlock.mock.calls.length
    expect(afterMount).toBe(50)
    const beforeStreaming = renderBlock.mock.calls.length

    for (let sequence = 0; sequence < 50; sequence += 1) {
      projection.apply({
        type: 'response.content',
        ...identity,
        eventId: `content-${sequence}`,
        cursor: sequence + 1,
        sequence,
        delta: `片段${sequence} `,
        contentIndex: 0
      } as StreamServerEvent)
      pending.splice(0).forEach((callback) => callback())
      act(() => view.rerender(<TaskPage {...pageProps} task={latest!} />))
    }

    // One render per tick: the open block of the streaming message.
    expect(renderBlock.mock.calls.length - beforeStreaming).toBe(50)
    // The history stays out of the renderer, and the last block is the stream tail.
    const streamedSources = renderBlock.mock.calls
      .slice(beforeStreaming)
      .map(([tokens]) => (tokens as Array<{ content?: string }>).map((token) => token.content ?? '').join(''))
    expect(streamedSources.some((source) => source.includes('回答'))).toBe(false)
    expect(streamedSources.at(-1)).toContain('片段49')
  })

  it('keeps the composer out of the streaming re-render path', () => {
    const pending: Array<() => void> = []
    let latest: TaskProjection | null = null
    const projection = new StreamTaskProjection({
      onChange: (task) => {
        latest = task
      },
      schedule: (callback) => pending.push(callback),
      cancelScheduled: () => pending.splice(0)
    })
    projection.attach(longTask())
    composerRenders.count = 0
    const view = render(<TaskPage {...pageProps} task={projection.snapshot()!} />)

    for (let sequence = 0; sequence < 20; sequence += 1) {
      projection.apply({
        type: 'response.content',
        ...identity,
        eventId: `content-${sequence}`,
        cursor: sequence + 1,
        sequence,
        delta: `片段${sequence} `,
        contentIndex: 0
      } as StreamServerEvent)
      pending.splice(0).forEach((callback) => callback())
      act(() => view.rerender(<TaskPage {...pageProps} task={latest!} />))
    }

    // Only the mount render: streaming ticks never reach the editor.
    expect(composerRenders.count).toBe(1)
  })
})
