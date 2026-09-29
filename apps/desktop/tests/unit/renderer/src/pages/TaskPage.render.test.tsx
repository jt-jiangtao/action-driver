import type { AgentMessageProjection, TaskProjection } from '@actiondriver/contracts'
import type { StreamServerEvent } from '@actiondriver/runtime-contracts'
import { act, render } from '@testing-library/react'
import MarkdownIt from 'markdown-it'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StreamTaskProjection } from '../../../../../src/renderer/src/services/stream-task-projection'
import { mockModelSelection } from '../../../../../src/renderer/src/testing/model-selection-fixture'
import { TaskPage } from '../../../../../src/renderer/src/pages/TaskPage'

const identity = {
  protocol: 'actiondriver.stream.v2' as const,
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
    const view = render(<TaskPage {...pageProps} task={projection.snapshot()!} />)

    const renderMarkdown = vi.spyOn(MarkdownIt.prototype, 'render')
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

    const rendered = renderMarkdown.mock.calls.map(([source]) => source)
    expect(rendered.filter((source) => source.startsWith('回答'))).toEqual([])
    expect(rendered).toHaveLength(50)
    expect(rendered.at(-1)).toContain('片段49')
  })
})
