import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LangGraphRunner,
  createSqliteCheckpointer,
  type ModelGateway,
  type SkillProvider,
  type SkillRegistry
} from '../src/index'

const temporaryDirectories: string[] = []

function checkpointPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'actiondriver-checkpoints-'))
  temporaryDirectories.push(directory)
  return join(directory, 'checkpoints.db')
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function waitingDependencies(): { model: ModelGateway; registry: SkillRegistry } {
  const model: ModelGateway = {
    async complete() {
      return { kind: 'invoke-skill', skillId: 'browser-use', input: { goal: 'approval' } }
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
  return { model, registry: { resolve: () => provider } }
}

describe('official SQLite checkpointer integration', () => {
  it('restores checkpoints and pending writes by thread and checkpoint id after restart', async () => {
    const path = checkpointPath()
    const dependencies = waitingDependencies()
    const firstCheckpointer = createSqliteCheckpointer(path)
    const firstRuntime = new LangGraphRunner(
      dependencies.model,
      dependencies.registry,
      firstCheckpointer
    )

    await expect(
      firstRuntime.run({
        taskId: 'task-persisted',
        goal: 'wait',
        model: { connectionId: 'connection-1', modelId: 'gpt-real' },
        skills: [{ skillId: 'browser-use', description: 'Operate a browser' }]
      })
    ).resolves.toMatchObject({
      status: 'waiting-user',
      threadId: 'task-persisted'
    })
    const beforeRestart = await firstCheckpointer.getTuple({
      configurable: { thread_id: 'task-persisted' }
    })
    expect(beforeRestart?.config.configurable?.checkpoint_id).toBeTruthy()
    expect(beforeRestart?.pendingWrites?.length ?? 0).toBeGreaterThan(0)
    const checkpointId = beforeRestart?.config.configurable?.checkpoint_id
    firstCheckpointer.db.close()

    const secondCheckpointer = createSqliteCheckpointer(path)
    const afterRestart = await secondCheckpointer.getTuple({
      configurable: { thread_id: 'task-persisted', checkpoint_id: checkpointId }
    })
    expect(afterRestart?.config.configurable?.thread_id).toBe('task-persisted')
    expect(afterRestart?.config.configurable?.checkpoint_id).toBe(checkpointId)

    const secondRuntime = new LangGraphRunner(
      dependencies.model,
      dependencies.registry,
      secondCheckpointer
    )
    await expect(
      secondRuntime.provideInput('task-persisted', { approved: true })
    ).resolves.toMatchObject({
      status: 'completed',
      output: { approved: true }
    })
    secondCheckpointer.db.close()
  })

  it('ignores corrupt or incomplete newer checkpoints and returns the latest valid one', async () => {
    const path = checkpointPath()
    const checkpointer = createSqliteCheckpointer(path)
    const dependencies = waitingDependencies()
    await new LangGraphRunner(dependencies.model, dependencies.registry, checkpointer).run({
      taskId: 'task-corrupt',
      goal: 'wait',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' }
    })
    const valid = await checkpointer.getTuple({ configurable: { thread_id: 'task-corrupt' } })

    checkpointer.db
      .prepare(
        `INSERT INTO checkpoints
          (thread_id, checkpoint_ns, checkpoint_id, type, checkpoint, metadata)
         VALUES (?, '', ?, 'json', ?, ?), (?, '', ?, 'json', NULL, NULL)`
      )
      .run(
        'task-corrupt',
        'zzzz-corrupt',
        Buffer.from('not-json'),
        Buffer.from('{}'),
        'task-corrupt',
        'zzzz-incomplete'
      )

    const recovered = await checkpointer.getTuple({ configurable: { thread_id: 'task-corrupt' } })
    expect(recovered?.config.configurable?.checkpoint_id).toBe(
      valid?.config.configurable?.checkpoint_id
    )
    checkpointer.db.close()
  })
})
