import { describe, expect, it, vi } from 'vitest'
import {
  LangGraphRunner,
  MockSkillRegistry,
  RUNTIME_TYPES,
  createRuntimeContainer,
  type ModelGateway,
  type ModelRequest,
  type TaskRepository
} from '../src/index'

describe('ModelGateway boundary', () => {
  it('receives only the current node context and explicit model parameters', async () => {
    const complete = vi.fn<ModelGateway['complete']>(async () => ({
      kind: 'finish',
      content: 'done'
    }))
    const runner = new LangGraphRunner({ complete }, new MockSkillRegistry())

    await runner.run({ taskId: 'task-context', goal: 'current goal only' })

    expect(complete).toHaveBeenCalledWith(
      {
        requestId: 'plan:task-context',
        messages: [{ role: 'user', content: 'current goal only' }],
        skills: [
          { skillId: 'browser-use', description: 'Operate a browser' },
          { skillId: 'computer-use', description: 'Operate the desktop' }
        ],
        parameters: { temperature: 0 }
      } satisfies ModelRequest,
      expect.anything()
    )
  })

  it('places the task main prompt before the user goal in the model request', async () => {
    const complete = vi.fn<ModelGateway['complete']>(async () => ({
      kind: 'finish',
      content: 'done'
    }))
    const runner = new LangGraphRunner({ complete }, new MockSkillRegistry())

    await runner.run({
      taskId: 'task-system-prompt',
      goal: 'Summarize the report',
      systemPrompt: '# Main prompt\n\nKeep answers concise.'
    })

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'system', content: '# Main prompt\n\nKeep answers concise.' },
          { role: 'user', content: 'Summarize the report' }
        ]
      }),
      expect.anything()
    )
  })

  it('turns remote failures into diagnostic task state without losing local history', async () => {
    const container = createRuntimeContainer({ mode: 'mock' })
    const tasks = container.get<TaskRepository>(RUNTIME_TYPES.taskRepository)
    const localTask = {
      id: 'task-model-error',
      threadId: 'task-model-error',
      goal: 'saved locally',
      status: 'submitted',
      lastCheckpointId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    await tasks.save(localTask)

    const model: ModelGateway = {
      async complete() {
        throw new Error('upstream unavailable')
      }
    }
    const result = await new LangGraphRunner(model, new MockSkillRegistry()).run({
      taskId: 'task-model-error',
      goal: 'saved locally'
    })

    expect(result).toMatchObject({
      status: 'failed',
      error: 'MODEL_GATEWAY_ERROR: upstream unavailable'
    })
    await expect(tasks.get('task-model-error')).resolves.toEqual(localTask)
  })
})
