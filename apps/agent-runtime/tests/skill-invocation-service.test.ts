import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RuntimeSkillRegistry,
  SkillInvocationService,
  SqliteRuntimeRepositories,
  openRuntimeDatabase,
  type RuntimeTaskRecord,
  type SkillProvider
} from '../src/index'

const temporaryDirectories: string[] = []

function createRepositories(): SqliteRuntimeRepositories {
  const directory = mkdtempSync(join(tmpdir(), 'actiondriver-skill-invocation-'))
  temporaryDirectories.push(directory)
  return new SqliteRuntimeRepositories(openRuntimeDatabase(join(directory, 'actiondriver.db')))
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const task: RuntimeTaskRecord = {
  id: 'task-skill',
  threadId: 'task-skill',
  goal: 'invoke browser capability',
  status: 'running',
  lastCheckpointId: 'checkpoint-skill',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('SkillInvocationService', () => {
  it('persists the logical skill, resolved provider, version, and lifecycle events', async () => {
    const repositories = createRepositories()
    await repositories.tasks.save(task)
    const registry = new RuntimeSkillRegistry()
    const provider: SkillProvider = {
      skillId: 'browser-use',
      providerId: 'browser-use.playwright-mock',
      providerVersion: '3.2.1',
      contractVersion: 1,
      async execute({ input }) {
        return { ok: true, providerId: 'browser-use.playwright-mock', input }
      }
    }
    registry.register(provider)
    const service = new SkillInvocationService(registry, repositories, {
      now: () => '2026-01-01T00:00:01.000Z'
    })

    await expect(
      service.execute({
        invocationId: 'invocation-alias',
        taskId: task.id,
        checkpointId: 'checkpoint-skill',
        requestedSkillId: 'browser-use',
        contractVersion: 1,
        input: { action: 'open-url', url: 'https://example.com' }
      })
    ).resolves.toEqual({
      ok: true,
      providerId: 'browser-use.playwright-mock',
      input: { action: 'open-url', url: 'https://example.com' }
    })

    await expect(repositories.skillInvocations.listByTask(task.id)).resolves.toEqual([
      {
        id: 'invocation-alias',
        taskId: task.id,
        requestedSkillId: 'browser-use',
        resolvedProviderId: 'browser-use.playwright-mock',
        providerVersion: '3.2.1',
        contractVersion: 1,
        status: 'completed',
        input: { action: 'open-url', url: 'https://example.com' },
        output: {
          ok: true,
          providerId: 'browser-use.playwright-mock',
          input: { action: 'open-url', url: 'https://example.com' }
        },
        error: null,
        createdAt: '2026-01-01T00:00:01.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z'
      }
    ])

    const events = await repositories.events.listAfter(0)
    expect(events.map((event) => event.type)).toEqual([
      'skill.queued',
      'skill.running',
      'skill.completed'
    ])
    expect(events[2]?.payload).toMatchObject({
      invocationId: 'invocation-alias',
      requestedSkillId: 'browser-use',
      resolvedProviderId: 'browser-use.playwright-mock',
      providerVersion: '3.2.1'
    })

    repositories.close()
  })

  it('keeps cancellation pending until the running provider reaches a terminal state', async () => {
    const repositories = createRepositories()
    await repositories.tasks.save(task)
    let rejectExecution!: (error: Error) => void
    let signalStarted!: () => void
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    const cancel = vi.fn(async () => undefined)
    const provider: SkillProvider = {
      skillId: 'browser-use',
      providerId: 'browser-use.cancellable',
      providerVersion: '1.0.0',
      contractVersion: 1,
      execute() {
        signalStarted()
        return new Promise((_, reject) => {
          rejectExecution = reject
        })
      },
      cancel
    }
    const registry = new RuntimeSkillRegistry()
    registry.register(provider)
    const service = new SkillInvocationService(registry, repositories, {
      now: () => '2026-01-01T00:00:02.000Z'
    })
    const execution = service.execute({
      invocationId: 'invocation-cancel',
      taskId: task.id,
      checkpointId: 'checkpoint-cancel',
      requestedSkillId: 'browser-use',
      contractVersion: 1,
      input: { action: 'open-url', url: 'https://example.com' }
    })
    await started

    let cancellationFinished = false
    const cancellation = service.cancel('invocation-cancel').then((result) => {
      cancellationFinished = true
      return result
    })
    await Promise.resolve()
    expect(cancel).toHaveBeenCalledOnce()
    expect(cancellationFinished).toBe(false)

    rejectExecution(new DOMException('cancelled', 'AbortError'))
    await expect(execution).rejects.toMatchObject({ name: 'AbortError' })
    await expect(cancellation).resolves.toBe(true)
    expect(cancellationFinished).toBe(true)

    await expect(repositories.skillInvocations.listByTask(task.id)).resolves.toEqual([
      expect.objectContaining({ id: 'invocation-cancel', status: 'cancelled' })
    ])
    expect((await repositories.events.listAfter(0)).at(-1)?.type).toBe('skill.cancelled')
    repositories.close()
  })
})
