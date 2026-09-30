import { describe, expect, it } from 'vitest'
import {
  DeterministicModelGateway,
  LangGraphRunner,
  MOCK_PENDING_PLAN_MARKER,
  MOCK_USER_INPUT_MARKER,
  type ModelRequest,
  type SkillProvider,
  type SkillRegistry
} from '../../src/index'

const modelRequest = (goal: string): ModelRequest => ({
  taskId: 'task-scenario',
  requestId: 'plan:task-scenario',
  model: { connectionId: 'connection-1', modelId: 'gpt-real' },
  messages: [{ role: 'user', content: goal }],
  skills: [{ skillId: 'browser-use', description: 'Operate a browser' }],
  parameters: { temperature: 0 }
})

describe('deterministic scenario markers', () => {
  it('keeps the first plan call pending until the run is interrupted', async () => {
    const gateway = new DeterministicModelGateway()
    const controller = new AbortController()
    const pending = gateway.complete(
      modelRequest(`整理行程${MOCK_PENDING_PLAN_MARKER}`),
      controller.signal
    )
    let settled = false
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )

    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(settled).toBe(false)

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    // The resumed attempt plans normally, so a continued task can still finish.
    await expect(
      gateway.complete(
        modelRequest(`整理行程${MOCK_PENDING_PLAN_MARKER}`),
        new AbortController().signal
      )
    ).resolves.toMatchObject({ kind: 'invoke-skill', skillId: 'browser-use' })
  })

  it('asks the Skill to hand off to the user and resumes with Command({ resume })', async () => {
    const provider: SkillProvider = {
      providerId: 'mock.browser',
      providerVersion: '1.0.0',
      skillId: 'browser-use',
      contractVersion: 1,
      async execute({ input }) {
        return { ok: true, providerId: 'mock.browser', input, needsUser: true }
      }
    }
    const registry: SkillRegistry = { resolve: () => provider }
    const runner = new LangGraphRunner(new DeterministicModelGateway(), registry)

    const waiting = await runner.run({
      taskId: 'task-confirm',
      goal: `预订酒店${MOCK_USER_INPUT_MARKER}`,
      model: { connectionId: 'connection-1', modelId: 'gpt-real' },
      skills: [{ skillId: 'browser-use', description: 'Operate a browser' }]
    })
    expect(waiting.status).toBe('waiting-user')

    await expect(runner.provideInput('task-confirm', { approved: true })).resolves.toMatchObject({
      status: 'completed',
      output: { approved: true }
    })
  })
})
