import { describe, expect, it, vi } from 'vitest'
import {
  LangGraphRunner,
  type ModelGateway,
  type SkillProvider,
  type SkillRegistry
} from '../src/index'

function registryFor(provider: SkillProvider): SkillRegistry {
  return { resolve: () => provider }
}

describe('LangGraph runtime control', () => {
  it('waits for user input and resumes with Command({ resume })', async () => {
    const model: ModelGateway = {
      async complete() {
        return { kind: 'invoke-skill', skillId: 'browser-use', input: { goal: 'approve' } }
      }
    }
    const provider: SkillProvider = {
      providerId: 'mock.waiting',
      providerVersion: '1.0.0',
      skillId: 'browser-use',
      contractVersion: 1,
      async execute({ input }) {
        return { ok: true, providerId: 'mock.waiting', input, needsUser: true }
      }
    }
    const runner = new LangGraphRunner(model, registryFor(provider))

    const waiting = await runner.run({
      taskId: 'task-wait',
      goal: 'request approval',
      skills: [{ skillId: 'browser-use', description: 'Operate a browser' }]
    })
    expect(waiting.status).toBe('waiting-user')

    const resumed = await runner.provideInput('task-wait', { approved: true })
    expect(resumed.status).toBe('completed')
    expect(resumed.output).toEqual({ approved: true })
    expect(resumed.trace).toEqual([
      'acceptGoal',
      'plan',
      'resolveSkill',
      'invokeSkill',
      'verifyOutcome',
      'awaitUser',
      'finish'
    ])
  })

  it('aborts an in-flight model, prevents skill execution, and continues from the safe checkpoint', async () => {
    let releaseStarted!: () => void
    const started = new Promise<void>((resolve) => {
      releaseStarted = resolve
    })
    let calls = 0
    const model: ModelGateway = {
      async complete(_request, signal) {
        calls += 1
        if (calls > 1) {
          return { kind: 'invoke-skill', skillId: 'browser-use', input: { resumed: true } }
        }

        releaseStarted()
        return new Promise((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted', 'AbortError')),
            { once: true }
          )
        })
      }
    }
    const execute = vi.fn(async ({ input }: { input: unknown }) => ({
      ok: true as const,
      providerId: 'mock.browser',
      input
    }))
    const provider: SkillProvider = {
      providerId: 'mock.browser',
      providerVersion: '1.0.0',
      skillId: 'browser-use',
      contractVersion: 1,
      execute
    }
    const runner = new LangGraphRunner(model, registryFor(provider))

    const running = runner.run({
      taskId: 'task-abort',
      goal: 'long model call',
      skills: [{ skillId: 'browser-use', description: 'Operate a browser' }]
    })
    await started
    expect(runner.interrupt('task-abort')).toBe(true)

    await expect(running).resolves.toMatchObject({ status: 'interrupted' })
    expect(execute).not.toHaveBeenCalled()

    const resumed = await runner.continue('task-abort')
    expect(resumed.status).toBe('completed')
    expect(execute).toHaveBeenCalledOnce()
  })
})
