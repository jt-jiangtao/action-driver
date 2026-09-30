import { describe, expect, it } from 'vitest'
import { createRuntimeServices } from '../../src/composition-root'

const modelRef = { connectionId: 'connection-1', modelId: 'gpt-real' }

describe('local mock runtime composition', () => {
  it('runs the deterministic skill path through explicit graph nodes', async () => {
    const runner = createRuntimeServices({ mode: 'mock' }).graphRunner

    const result = await runner.run({
      taskId: 'task-42',
      goal: '打开产品主页',
      model: modelRef,
      skills: [{ skillId: 'browser-use', description: 'Operate a browser' }]
    })

    expect(result).toEqual({
      taskId: 'task-42',
      threadId: 'task-42',
      status: 'completed',
      output: { ok: true, providerId: 'mock.browser', input: { goal: '打开产品主页' } },
      error: null,
      trace: ['acceptGoal', 'plan', 'resolveSkill', 'invokeSkill', 'verifyOutcome', 'finish']
    })
    expect(structuredClone(result)).toEqual(result)
  })

})
