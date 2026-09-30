import { describe, expect, it } from 'vitest'
import type { StreamSessionRepository } from '../../src/ports'
import { readSessionHistory } from '../../src/stream/session-history'

describe('session history', () => {
  it('keeps only user and assistant messages from finished turns', async () => {
    const repositories = {
      tasks: {
        listBySession: async () => [
          { id: 'finished', status: 'completed' },
          { id: 'running', status: 'running' }
        ]
      },
      messages: {
        listBySession: async () => [
          { taskId: 'finished', role: 'user', content: { text: '问题' } },
          { taskId: 'finished', role: 'tool', content: { text: '内部结果' } },
          { taskId: 'finished', role: 'assistant', content: { text: '回答' } },
          { taskId: 'running', role: 'user', content: { text: '未完成' } }
        ]
      }
    } as unknown as StreamSessionRepository

    expect(await readSessionHistory(repositories, 'session-1')).toEqual([
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '回答' }
    ])
  })
})
