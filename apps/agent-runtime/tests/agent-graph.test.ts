import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LangGraphRunner,
  MockSkillRegistry,
  RUNTIME_TYPES,
  createRuntimeContainer,
  threadIdForTask,
  type GraphRunner,
  type ModelGateway,
  type SkillProvider,
  type SkillRegistry
} from '../src/index'

describe('minimal agent StateGraph', () => {
  it('runs the deterministic skill path through explicit graph nodes', async () => {
    const container = createRuntimeContainer({ mode: 'mock' })
    const runner = container.get<GraphRunner>(RUNTIME_TYPES.graphRunner)

    const result = await runner.run({ taskId: 'task-42', goal: '打开产品主页' })

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

  it('maps a task id to one stable LangGraph thread id', () => {
    expect(threadIdForTask('task-42')).toBe('task-42')
    expect(threadIdForTask('task-42')).toBe(threadIdForTask('task-42'))
    expect(() => threadIdForTask('')).toThrow('Task id is required')
  })

  it('routes unavailable skills through the failed node', async () => {
    const model: ModelGateway = {
      async complete() {
        return { kind: 'invoke-skill', skillId: 'missing-skill', input: {} }
      }
    }
    const result = await new LangGraphRunner(model, new MockSkillRegistry()).run({
      taskId: 'task-failed',
      goal: 'use a missing skill'
    })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('CAPABILITY_UNAVAILABLE')
    expect(result.trace).toEqual([
      'acceptGoal',
      'plan',
      'resolveSkill',
      'invokeSkill',
      'verifyOutcome',
      'failed'
    ])
  })

  it('routes provider requests for user input through awaitUser', async () => {
    const provider: SkillProvider = {
      providerId: 'mock.waiting',
      providerVersion: '1.0.0',
      skillId: 'browser-use',
      contractVersion: 1,
      async execute({ input }) {
        return { ok: true, providerId: 'mock.waiting', input, needsUser: true }
      }
    }
    const registry: SkillRegistry = { resolve: () => provider }
    const model: ModelGateway = {
      async complete() {
        return { kind: 'invoke-skill', skillId: 'browser-use', input: { question: 'continue?' } }
      }
    }
    const result = await new LangGraphRunner(model, registry).run({
      taskId: 'task-waiting',
      goal: 'ask first'
    })

    expect(result.status).toBe('waiting-user')
    expect(result.trace.at(-1)).toBe('awaitUser')
  })

  it('keeps LangGraph types out of shared domain contracts', async () => {
    const contractSources = await Promise.all([
      readFile(resolve(process.cwd(), 'packages/contracts/src/index.ts'), 'utf8'),
      readFile(resolve(process.cwd(), 'packages/runtime-contracts/src/protocol.ts'), 'utf8')
    ])

    expect(contractSources.join('\n')).not.toMatch(/@langchain\/(?:langgraph|core)/)
  })
})
