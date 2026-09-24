import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition, ToolExecutor } from '@actiondriver/runtime-contracts'
import {
  LangGraphRunner,
  MockSkillRegistry,
  RuntimeToolPolicy,
  RuntimeToolRegistry,
  ToolInvocationService,
  createRuntimeServices,
  threadIdForTask,
  type ModelGateway,
  type SkillProvider,
  type SkillRegistry
} from '../src/index'
import { activityTitleForTool, activityTitleForTools } from '../src/agent-graph'

const modelRef = { connectionId: 'connection-1', modelId: 'gpt-real' }

describe('minimal agent StateGraph', () => {
  it('distinguishes shell commands from web search in group titles', () => {
    expect(activityTitleForTool('shell_run')).toBe('正在执行命令')
    expect(activityTitleForTool('web_search')).toBe('正在搜索网页')
    expect(activityTitleForTool('web_open')).toBe('正在读取网页')
    expect(activityTitleForTools('read pages', ['web_open', 'web_open'])).toBe('正在执行 2 项网页读取')
  })
  it('updates a mixed group summary as its tools and outcomes change', () => {
    const goal = '测试所有工具'
    expect(activityTitleForTools(goal, ['shell_run', 'python_run'])).toBe(
      '正在测试所有工具：命令、脚本'
    )
    expect(activityTitleForTools(goal, ['shell_run', 'python_run', 'web_search'])).toBe(
      '正在测试所有工具：命令、脚本、网页'
    )
    expect(
      activityTitleForTools(goal, ['shell_run', 'python_run', 'web_search'], 'completed', 1)
    ).toBe('测试所有工具：命令、脚本、网页（1 项未完成）')
  })
  it('uses a concise task intent for a single tool and a homogeneous group', () => {
    const goal = '读取 README 的第一段'
    expect(activityTitleForTools(goal, ['shell_run'])).toBe('正在读取 README 的第一段')
    expect(activityTitleForTools(goal, ['shell_run', 'shell_run'])).toBe(
      '正在读取 README 的第一段 · 2 条命令'
    )
    expect(activityTitleForTools(goal, ['shell_run', 'shell_run'], 'completed')).toBe(
      '已完成读取 README 的第一段 · 2 条命令'
    )
    expect(
      activityTitleForTools('在阻塞文件中查找 needle', ['sandbox_shell_run'], 'failed', 1)
    ).toBe('在阻塞文件中查找 needle（执行失败）')
  })
  it('keeps activity titles and tool associations in the runtime without a model activity tool', async () => {
    let round = 0
    const observed: unknown[] = []
    const toolRecords: Array<{
      payload: { activityId?: string | null; callId?: string; title?: string }
    }> = []
    const model: ModelGateway = {
      async complete(request) {
        round += 1
        if (round === 1) {
          expect(request.tools?.map((tool) => tool.modelName)).toEqual(['shell_run'])
          return {
            kind: 'tool-calls',
            calls: [
              {
                providerCallId: 'provider-read-first',
                modelName: 'shell_run',
                arguments: { command: 'cat README.md' }
              },
              {
                providerCallId: 'provider-read-second',
                modelName: 'shell_run',
                arguments: { command: 'cat package.json' }
              }
            ]
          }
        }
        expect(request.messages.filter((message) => message.role === 'tool')).toHaveLength(2)
        expect(
          request.messages.some(
            (message) => message.role === 'tool' && message.name === 'activity_update'
          )
        ).toBe(false)
        return { kind: 'finish', content: 'done' }
      }
    }
    const { runner, commits } = toolRunner(model, {
      async *execute() {
        yield { kind: 'result', output: 'README' }
      }
    })

    await runner.run(
      { taskId: 'task-activity', goal: 'research', model: modelRef },
      undefined,
      (event) => {
        observed.push(event)
      },
      (record) => {
        toolRecords.push(
          record as { payload: { activityId?: string | null; callId?: string; title?: string } }
        )
      }
    )

    expect(
      observed.filter(
        (event) =>
          typeof event === 'object' &&
          event !== null &&
          'kind' in event &&
          event.kind === 'activity'
      )
    ).toEqual([
      {
        kind: 'activity',
        event: {
          type: 'started',
          activityId: 'activity:task-activity:default',
          title: '正在执行命令',
          titleRevision: 1
        }
      },
      {
        kind: 'activity',
        event: {
          type: 'updated',
          activityId: 'activity:task-activity:default',
          title: '已执行命令',
          titleRevision: 2
        }
      },
      {
        kind: 'activity',
        event: {
          type: 'updated',
          activityId: 'activity:task-activity:default',
          title: '正在执行 2 条命令',
          titleRevision: 3
        }
      },
      {
        kind: 'activity',
        event: {
          type: 'updated',
          activityId: 'activity:task-activity:default',
          title: '已执行 2 条命令',
          titleRevision: 4
        }
      },
      {
        kind: 'activity',
        event: { type: 'completed', activityId: 'activity:task-activity:default' }
      }
    ])
    expect(
      toolRecords.every(
        (record) =>
          record.payload.activityId === 'activity:task-activity:default' &&
          typeof record.payload.callId === 'string'
      )
    ).toBe(true)
    expect(toolRecords[0]?.payload.title).toBe('正在执行命令')
    expect(toolRecords[3]?.payload.title).toBe('已执行命令')
    expect(commits).toEqual([
      'proposed',
      'queued',
      'running',
      'completed',
      'proposed',
      'queued',
      'running',
      'completed'
    ])
  })

  it.each([
    ['failed', new Error('read failed'), '执行命令失败'],
    [
      'cancelled',
      Object.assign(new Error('read cancelled'), { name: 'AbortError' }),
      '已取消执行命令'
    ]
  ])('updates the group title when a tool is %s', async (_status, failure, title) => {
    let round = 0
    const observed: unknown[] = []
    const model: ModelGateway = {
      async complete() {
        round += 1
        return round === 1
          ? {
              kind: 'tool-calls' as const,
              calls: [
                {
                  providerCallId: 'provider-read',
                  modelName: 'shell_run',
                  arguments: { command: 'cat README.md' }
                }
              ]
            }
          : { kind: 'finish' as const, content: 'done' }
      }
    }
    const { runner } = toolRunner(model, {
      async *execute() {
        yield { kind: 'result', output: 'partial read' }
        throw failure
      }
    })
    await runner.run(
      { taskId: `task-${_status}`, goal: 'read', model: modelRef },
      undefined,
      (event) => {
        observed.push(event)
      }
    )
    expect(observed).toContainEqual({
      kind: 'activity',
      event: {
        type: 'updated',
        activityId: `activity:task-${_status}:default`,
        title,
        titleRevision: 2
      }
    })
  })

  it('keeps a failed tool visible in the final multi-tool group title', async () => {
    let round = 0
    let invocation = 0
    const observed: unknown[] = []
    const model: ModelGateway = {
      async complete() {
        round += 1
        return round === 1
          ? {
              kind: 'tool-calls' as const,
              calls: [
                {
                  providerCallId: 'first',
                  modelName: 'shell_run',
                  arguments: { command: 'cat first.txt' }
                },
                {
                  providerCallId: 'second',
                  modelName: 'shell_run',
                  arguments: { command: 'cat second.txt' }
                }
              ]
            }
          : { kind: 'finish' as const, content: 'done' }
      }
    }
    const { runner } = toolRunner(model, {
      async *execute() {
        invocation += 1
        if (invocation === 1) throw new Error('read failed')
        yield { kind: 'result', output: 'second file' }
      }
    })
    await runner.run(
      { taskId: 'task-partial-failure', goal: 'read files', model: modelRef },
      undefined,
      (event) => {
        observed.push(event)
      }
    )
    expect(observed).toContainEqual({
      kind: 'activity',
      event: {
        type: 'updated',
        activityId: 'activity:task-partial-failure:default',
        title: '已处理 2 条命令（1 项未完成）',
        titleRevision: 4
      }
    })
  })

  it('creates one default activity and assigns unlabelled tools to it', async () => {
    let round = 0
    const observed: unknown[] = []
    const toolRecords: Array<{ payload?: { activityId?: string | null } }> = []
    const model: ModelGateway = {
      async complete() {
        round += 1
        if (round === 1) {
          return {
            kind: 'tool-calls' as const,
            calls: [
              {
                providerCallId: 'provider-read-first',
                modelName: 'shell_run',
                arguments: { command: 'cat README.md' }
              },
              {
                providerCallId: 'provider-read-second',
                modelName: 'shell_run',
                arguments: { command: 'cat package.json' }
              }
            ]
          }
        }
        return { kind: 'finish' as const, content: 'done' }
      }
    }
    const { runner } = toolRunner(model, {
      async *execute() {
        yield { kind: 'result', output: 'file content' }
      }
    })

    await runner.run(
      { taskId: 'task-fallback-activity', goal: 'read files', model: modelRef },
      undefined,
      (event) => {
        observed.push(event)
      },
      (record) => {
        toolRecords.push(record as { payload?: { activityId?: string | null } })
      }
    )

    expect(observed).toContainEqual({
      kind: 'activity',
      event: {
        type: 'started',
        activityId: 'activity:task-fallback-activity:default',
        title: '正在执行命令',
        titleRevision: 1
      }
    })
    expect(observed).toContainEqual({
      kind: 'activity',
      event: { type: 'completed', activityId: 'activity:task-fallback-activity:default' }
    })
    expect(observed).toContainEqual({
      kind: 'activity',
      event: {
        type: 'updated',
        activityId: 'activity:task-fallback-activity:default',
        title: '已执行命令',
        titleRevision: 2
      }
    })
    expect(observed).toContainEqual({
      kind: 'activity',
      event: {
        type: 'updated',
        activityId: 'activity:task-fallback-activity:default',
        title: '正在执行 2 条命令',
        titleRevision: 3
      }
    })
    expect(observed).toContainEqual({
      kind: 'activity',
      event: {
        type: 'updated',
        activityId: 'activity:task-fallback-activity:default',
        title: '已执行 2 条命令',
        titleRevision: 4
      }
    })
    expect(toolRecords).toHaveLength(8)
    expect(
      toolRecords
        .filter((record) => record.payload?.activityId !== undefined)
        .map((record) => record.payload?.activityId)
    ).toEqual([
      'activity:task-fallback-activity:default',
      'activity:task-fallback-activity:default',
      'activity:task-fallback-activity:default',
      'activity:task-fallback-activity:default',
      'activity:task-fallback-activity:default',
      'activity:task-fallback-activity:default',
      'activity:task-fallback-activity:default',
      'activity:task-fallback-activity:default'
    ])
  })

  it('does not create a tool activity for a text-only answer', async () => {
    const observed: unknown[] = []
    const model: ModelGateway = {
      async complete(request) {
        expect(request.tools).toBeUndefined()
        return { kind: 'finish', content: '最终结论' }
      }
    }

    const result = await new LangGraphRunner(model, new MockSkillRegistry()).run(
      { taskId: 'task-activity-text', goal: 'research', model: modelRef },
      undefined,
      (event) => {
        observed.push(event)
      }
    )

    expect(result).toMatchObject({ status: 'completed', output: '最终结论' })
    expect(observed).toEqual([])
  })

  it('streams ordered process text before a tool and final text after it', async () => {
    let round = 0
    const observed: unknown[] = []
    const model: ModelGateway = {
      async complete() {
        throw new Error('stream path expected')
      },
      async *stream() {
        round += 1
        if (round === 1) {
          yield { kind: 'content' as const, delta: '正文 A' }
          yield {
            kind: 'end' as const,
            content: '正文 A',
            finishReason: 'tool_calls',
            usage: null,
            result: {
              kind: 'tool-calls' as const,
              calls: [
                {
                  providerCallId: 'read-a',
                  modelName: 'shell_run',
                  arguments: { command: 'cat README.md' }
                }
              ]
            }
          }
          return
        }
        yield { kind: 'content' as const, delta: '最终结论' }
        yield {
          kind: 'end' as const,
          content: '最终结论',
          finishReason: 'stop',
          usage: null,
          result: { kind: 'final-text' as const, content: '最终结论' }
        }
      }
    }
    const { runner } = toolRunner(model, {
      async *execute() {
        yield { kind: 'result', output: 'README' }
      }
    })

    const result = await runner.run(
      { taskId: 'task', goal: 'read', model: modelRef },
      undefined,
      (event) => {
        observed.push(event)
      }
    )

    expect(result).toMatchObject({ status: 'completed', output: '最终结论' })
    const firstToolActivity = observed.findIndex(
      (event) =>
        typeof event === 'object' &&
        event !== null &&
        'kind' in event &&
        event.kind === 'activity' &&
        'event' in event &&
        typeof event.event === 'object' &&
        event.event !== null &&
        'type' in event.event &&
        event.event.type === 'started'
    )
    expect(firstToolActivity).toBeGreaterThan(0)
    expect(observed.slice(0, firstToolActivity)).not.toContainEqual(
      expect.objectContaining({
        kind: 'activity',
        event: expect.objectContaining({ type: 'started' })
      })
    )
    expect(observed[firstToolActivity]).toEqual({
      kind: 'activity',
      event: {
        type: 'started',
        activityId: 'activity:task:default',
        title: '正在执行命令',
        titleRevision: 1
      }
    })
    expect(observed).toEqual(
      expect.arrayContaining([
        {
          kind: 'activity',
          event: {
            type: 'text',
            activityId: null,
            textId: 'plan:task',
            delta: '正文 A'
          }
        },
        {
          kind: 'activity',
          event: {
            type: 'text.done',
            activityId: null,
            textId: 'plan:task',
            phase: 'process'
          }
        },
        {
          kind: 'activity',
          event: {
            type: 'text',
            activityId: null,
            textId: 'plan:task:1',
            delta: '最终结论'
          }
        },
        {
          kind: 'activity',
          event: {
            type: 'text.done',
            activityId: null,
            textId: 'plan:task:1',
            phase: 'final'
          }
        }
      ])
    )
    expect(
      observed.filter(
        (event) =>
          typeof event === 'object' && event !== null && 'kind' in event && event.kind === 'content'
      )
    ).toEqual([
      { kind: 'content', delta: '正文 A' },
      { kind: 'content', delta: '最终结论' }
    ])
  })

  it('keeps contiguous tools together and starts a new group after visible text', async () => {
    let round = 0
    const observed: unknown[] = []
    const toolActivityIds: Array<string | null | undefined> = []
    const model: ModelGateway = {
      async complete() {
        throw new Error('stream path expected')
      },
      async *stream() {
        round += 1
        if (round === 1 || round === 3) {
          yield { kind: 'content' as const, delta: round === 1 ? '先说明' : '再说明' }
        }
        if (round < 4) {
          yield {
            kind: 'end' as const,
            content: '',
            finishReason: 'tool_calls',
            usage: null,
            result: {
              kind: 'tool-calls' as const,
              calls: [
                {
                  providerCallId: `provider-${round}`,
                  modelName: 'shell_run',
                  arguments: { command: `cat file-${round}.txt` }
                }
              ]
            }
          }
          return
        }
        yield { kind: 'content' as const, delta: '最终回答' }
        yield {
          kind: 'end' as const,
          content: '最终回答',
          finishReason: 'stop',
          usage: null,
          result: { kind: 'final-text' as const, content: '最终回答' }
        }
      }
    }
    const { runner } = toolRunner(model, {
      async *execute() {
        yield { kind: 'result', output: 'ok' }
      }
    })
    await runner.run(
      { taskId: 'task-groups', goal: 'read', model: modelRef },
      undefined,
      (event) => {
        observed.push(event)
      },
      (record) => {
        if (record.type === 'tool.proposed') {
          toolActivityIds.push((record.payload as { activityId?: string | null }).activityId)
        }
      }
    )
    expect(toolActivityIds).toEqual([
      'activity:task-groups:default',
      'activity:task-groups:default',
      'activity:task-groups:tools:3:0'
    ])
    const activityEvents = observed
      .filter(
        (
          event
        ): event is {
          kind: 'activity'
          event: { type: string; activityId?: string | null; title?: string }
        } =>
          typeof event === 'object' &&
          event !== null &&
          'kind' in event &&
          event.kind === 'activity'
      )
      .map(({ event }) => event)
    expect(activityEvents.filter((event) => event.type === 'started')).toEqual([
      expect.objectContaining({
        activityId: 'activity:task-groups:default',
        title: '正在执行命令'
      }),
      expect.objectContaining({
        activityId: 'activity:task-groups:tools:3:0',
        title: '正在执行命令'
      })
    ])
    expect(activityEvents).toContainEqual(
      expect.objectContaining({
        activityId: 'activity:task-groups:default',
        title: '正在执行 2 条命令'
      })
    )
    const secondText = activityEvents.findIndex(
      (event) =>
        event.type === 'text' &&
        event.activityId === null &&
        'delta' in event &&
        event.delta === '再说明'
    )
    expect(
      activityEvents.findIndex(
        (event) => event.type === 'completed' && event.activityId === 'activity:task-groups:default'
      )
    ).toBeLessThan(secondText)
  })

  it('does not classify interrupted streamed text as a completed final answer', async () => {
    const observed: unknown[] = []
    const model: ModelGateway = {
      async complete() {
        throw new Error('stream path expected')
      },
      async *stream() {
        yield { kind: 'content' as const, delta: '部分内容' }
        throw new Error('stream interrupted')
      }
    }
    const result = await new LangGraphRunner(model, new MockSkillRegistry()).run(
      { taskId: 'task-stream-error', goal: 'answer', model: modelRef },
      undefined,
      (event) => {
        observed.push(event)
      }
    )

    expect(result.status).toBe('failed')
    expect(observed).toContainEqual({
      kind: 'activity',
      event: {
        type: 'text',
        activityId: null,
        textId: 'plan:task-stream-error',
        delta: '部分内容'
      }
    })
    expect(observed).not.toContainEqual(
      expect.objectContaining({
        kind: 'activity',
        event: expect.objectContaining({ type: 'text.done', phase: 'final' })
      })
    )
  })

  it('runs a model tool request and returns only the final model answer', async () => {
    const requests: Parameters<ModelGateway['complete']>[0][] = []
    const model: ModelGateway = {
      async complete(request) {
        requests.push(request)
        if (requests.length === 1) {
          return {
            kind: 'tool-calls',
            calls: [
              {
                providerCallId: 'provider-read-1',
                modelName: 'shell_run',
                arguments: { command: 'cat README.md' }
              }
            ]
          }
        }
        return { kind: 'finish', content: '**done**' }
      }
    }
    const { runner } = toolRunner(model, {
      async *execute() {
        yield { kind: 'content', stream: 'result', delta: 'README content' }
      }
    })
    const result = await runner.run({
      taskId: 'task-tool-loop',
      goal: 'Read README',
      model: modelRef
    })

    expect(result).toMatchObject({ status: 'completed', output: '**done**' })
    expect(requests).toHaveLength(2)
    expect(requests[0]?.tools?.map((tool) => tool.modelName)).toEqual(['shell_run'])
    expect(requests[1]?.messages.at(-2)).toMatchObject({
      role: 'assistant',
      toolCalls: [{ providerCallId: 'provider-read-1' }]
    })
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'provider-read-1'
    })
    expect(JSON.stringify(result.output)).not.toContain('README content')
  })

  it('handles a streamed tool-call terminal without showing it as assistant text', async () => {
    const observed: unknown[] = []
    const toolRecords: unknown[] = []
    let round = 0
    const model: ModelGateway = {
      async complete() {
        throw new Error('stream path expected')
      },
      async *stream() {
        round += 1
        if (round === 1) {
          yield {
            kind: 'end' as const,
            result: {
              kind: 'tool-calls' as const,
              calls: [
                {
                  providerCallId: 'provider-stream-1',
                  modelName: 'shell_run',
                  arguments: { command: 'cat README.md' }
                }
              ]
            },
            content: '',
            finishReason: 'tool_calls',
            usage: null
          }
          return
        }
        yield { kind: 'content' as const, delta: '**done**' }
        yield {
          kind: 'end' as const,
          result: { kind: 'final-text' as const, content: '**done**' },
          content: '**done**',
          finishReason: 'stop',
          usage: null
        }
      }
    }
    const { runner } = toolRunner(model, {
      async *execute() {
        yield { kind: 'result', output: 'README' }
      }
    })
    const result = await runner.run(
      {
        taskId: 'task-stream-tool',
        goal: 'read',
        model: modelRef,
        streamRequestId: 'request-stream-tool'
      },
      undefined,
      (event) => {
        observed.push(event)
      },
      (record) => {
        toolRecords.push(record)
      }
    )
    expect(result).toMatchObject({ status: 'completed', output: '**done**' })
    expect(
      observed.filter(
        (event) =>
          typeof event === 'object' && event !== null && 'kind' in event && event.kind === 'content'
      )
    ).toEqual([{ kind: 'content', delta: '**done**' }])
    expect(toolRecords).toContainEqual(
      expect.objectContaining({
        type: 'tool.completed',
        requestId: 'request-stream-tool',
        cursor: expect.any(Number)
      })
    )
  })

  it('returns denied tool errors to the model without executing the tool', async () => {
    const execute = vi.fn(async function* () {
      yield { kind: 'result' as const, output: 'must not run' }
    })
    let round = 0
    const model: ModelGateway = {
      async complete(request) {
        round += 1
        if (round === 1) {
          expect(request.tools).toBeUndefined()
          return {
            kind: 'tool-calls',
            calls: [
              {
                providerCallId: 'provider-denied',
                modelName: 'shell_run',
                arguments: { command: 'cat README.md' }
              }
            ]
          }
        }
        expect(request.messages.at(-1)).toMatchObject({
          role: 'tool',
          toolCallId: 'provider-denied',
          content: expect.stringContaining('TOOL_DENIED')
        })
        return { kind: 'finish', content: 'Unable to read' }
      }
    }
    const { runner } = toolRunner(model, { execute })
    const result = await runner.run({
      taskId: 'task-denied-tool',
      goal: 'read',
      model: modelRef,
      toolGrants: []
    })
    expect(result).toMatchObject({ status: 'completed', output: 'Unable to read' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('runs multiple calls in provider order and stops after the tool round budget', async () => {
    const order: string[] = []
    let rounds = 0
    const model: ModelGateway = {
      async complete() {
        rounds += 1
        if (rounds === 1) {
          return {
            kind: 'tool-calls',
            calls: [
              { providerCallId: 'first', modelName: 'shell_run', arguments: { command: 'cat a' } },
              { providerCallId: 'second', modelName: 'shell_run', arguments: { command: 'cat b' } }
            ]
          }
        }
        return { kind: 'finish', content: 'final' }
      }
    }
    const { runner } = toolRunner(model, {
      async *execute(call) {
        order.push(String(call.arguments.command))
        yield { kind: 'result', output: { command: call.arguments.command } }
      }
    })
    expect((await runner.run({ taskId: 'task-multi', goal: 'read', model: modelRef })).status).toBe(
      'completed'
    )
    expect(order).toEqual(['cat a', 'cat b'])

    let callCount = 0
    const endless: ModelGateway = {
      async complete() {
        return {
          kind: 'tool-calls',
          calls: [
            {
              providerCallId: `provider-${++callCount}`,
              modelName: 'shell_run',
              arguments: { command: 'cat README.md' }
            }
          ]
        }
      }
    }
    const budget = toolRunner(endless, {
      async *execute() {
        yield { kind: 'result', output: 'ok' }
      }
    })
    const exhausted = await budget.runner.run({
      taskId: 'task-budget',
      goal: 'loop',
      model: modelRef
    })
    expect(exhausted).toMatchObject({ status: 'failed', error: 'TOOL_BUDGET_EXCEEDED' })
    expect(budget.commits.filter((status) => status === 'completed')).toHaveLength(512)
  }, 120_000)

  it('rejects a model response exceeding the call budget before invoking a tool', async () => {
    const execute = vi.fn(async function* () {
      yield { kind: 'result' as const, output: 'never' }
    })
    const model: ModelGateway = {
      async complete() {
        return {
          kind: 'tool-calls',
          calls: Array.from({ length: 513 }, (_, index) => ({
            providerCallId: `provider-${index}`,
            modelName: 'shell_run',
            arguments: { command: 'cat README.md' }
          }))
        }
      }
    }
    const { runner } = toolRunner(model, { execute })
    const result = await runner.run({ taskId: 'task-call-budget', goal: 'loop', model: modelRef })
    expect(result).toMatchObject({ status: 'failed', error: 'TOOL_BUDGET_EXCEEDED' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('executes 100 calls of each current tool in one task before generating the final answer', async () => {
    const names = ['shell_run', 'python_run', 'node_run', 'web_search'] as const
    const executed: string[] = []
    let modelTurns = 0
    const model: ModelGateway = {
      async complete(request) {
        modelTurns += 1
        if (modelTurns === 1) {
          return {
            kind: 'tool-calls',
            calls: Array.from({ length: 400 }, (_, index) => ({
              providerCallId: `batch-${index}`,
              modelName: names[index % names.length]!,
              arguments: { command: `item-${index}` }
            }))
          }
        }
        expect(request.messages.filter((message) => message.role === 'tool')).toHaveLength(400)
        return { kind: 'finish', content: '400 complete' }
      }
    }
    const registry = new RuntimeToolRegistry()
    const policy = new RuntimeToolPolicy()
    for (const name of names) {
      registry.register(
        { ...shellTool, id: `test.${name}`, modelName: name },
        {
          async *execute(call) {
            executed.push(call.modelName)
            yield { kind: 'result', output: call.arguments.command }
          }
        }
      )
    }
    let cursor = 0
    const invocations = new ToolInvocationService({
      registry,
      policy,
      persistence: {
        async commitToolInvocationWithEvent(_invocation, event) {
          return { ...event, cursor: ++cursor }
        }
      },
      clock: { now: () => new Date().toISOString() }
    })
    const runner = new LangGraphRunner(model, new MockSkillRegistry(), undefined, {
      registry,
      policy,
      invocations,
      grants: names.map((name) => `test.${name}@1`)
    })
    const result = await runner.run({ taskId: 'task-400', goal: 'test all tools', model: modelRef })
    expect(result).toMatchObject({ status: 'completed', output: '400 complete' })
    for (const name of names) {
      expect(executed.filter((value) => value === name)).toHaveLength(100)
    }
  }, 60_000)

  it('allows 400 single-call rounds and still refuses call 513 before execution', async () => {
    let turns = 0
    let executions = 0
    const model: ModelGateway = {
      async complete() {
        turns += 1
        if (turns === 401) return { kind: 'finish', content: 'rounds complete' }
        return {
          kind: 'tool-calls',
          calls: [
            {
              providerCallId: `round-${turns}`,
              modelName: 'shell_run',
              arguments: { command: 'printf ok' }
            }
          ]
        }
      }
    }
    const { runner } = toolRunner(model, {
      async *execute() {
        executions += 1
        yield { kind: 'result', output: 'ok' }
      }
    })
    const result = await runner.run({ taskId: 'task-400-rounds', goal: 'loop', model: modelRef })
    expect(result).toMatchObject({ status: 'completed', output: 'rounds complete' })
    expect(executions).toBe(400)

    const tooMany: ModelGateway = {
      async complete() {
        return {
          kind: 'tool-calls',
          calls: Array.from({ length: 513 }, (_, index) => ({
            providerCallId: `excess-${index}`,
            modelName: 'shell_run',
            arguments: { command: 'printf no' }
          }))
        }
      }
    }
    let excessExecutions = 0
    const excess = toolRunner(tooMany, {
      async *execute() {
        excessExecutions += 1
        yield { kind: 'result', output: 'not reached' }
      }
    })
    expect(
      await excess.runner.run({ taskId: 'task-513', goal: 'loop', model: modelRef })
    ).toMatchObject({
      status: 'failed',
      error: 'TOOL_BUDGET_EXCEEDED'
    })
    expect(excessExecutions).toBe(0)
  }, 120_000)

  it('propagates cancellation to the active executor before the run resolves', async () => {
    const controller = new AbortController()
    let started!: () => void
    const executorStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    let terminated = false
    const model: ModelGateway = {
      async complete() {
        return {
          kind: 'tool-calls',
          calls: [
            {
              providerCallId: 'provider-cancel',
              modelName: 'shell_run',
              arguments: { command: 'cat README.md' }
            }
          ]
        }
      }
    }
    const { runner } = toolRunner(model, {
      async *execute(_call, signal) {
        started()
        try {
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              { once: true }
            )
          })
        } finally {
          terminated = true
        }
        yield { kind: 'result', output: null }
      }
    })
    const running = runner.run(
      { taskId: 'task-cancel-tool', goal: 'read', model: modelRef },
      controller.signal
    )
    await executorStarted
    controller.abort(new DOMException('Cancelled', 'AbortError'))
    const result = await running
    expect(terminated).toBe(true)
    expect(result.status).toBe('interrupted')
  })
  it('sends persisted conversation history before the new user turn', async () => {
    const requests: Parameters<ModelGateway['complete']>[0][] = []
    const model: ModelGateway = {
      async complete(request) {
        requests.push(request)
        return { kind: 'finish', content: '第二答' }
      }
    }

    await new LangGraphRunner(model, new MockSkillRegistry()).run({
      taskId: 'task-2',
      goal: '第二问',
      model: modelRef,
      systemPrompt: 'system',
      messages: [
        { role: 'user', content: '第一问' },
        { role: 'assistant', content: '第一答' }
      ],
      skills: []
    })

    expect(requests[0]?.messages).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: '第二问' }
    ])
  })

  it('publishes model deltas before completion and returns the terminal aggregate', async () => {
    let releaseEnd!: () => void
    const endGate = new Promise<void>((resolve) => {
      releaseEnd = resolve
    })
    let sawFirstDelta!: () => void
    const firstDelta = new Promise<void>((resolve) => {
      sawFirstDelta = resolve
    })
    const observed: unknown[] = []
    const model: ModelGateway = {
      async complete() {
        throw new Error('legacy completion must not be used')
      },
      async *stream() {
        yield { kind: 'content' as const, delta: '# Real' }
        await endGate
        yield { kind: 'content' as const, delta: ' answer' }
        yield {
          kind: 'end' as const,
          content: '# Real answer',
          finishReason: 'stop',
          usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 }
        }
      }
    }
    const runner = new LangGraphRunner(model, new MockSkillRegistry())
    const running = runner.run(
      {
        taskId: 'task-streaming',
        goal: 'stream the answer',
        model: modelRef
      },
      undefined,
      (event) => {
        observed.push(event)
        if (
          typeof event === 'object' &&
          event !== null &&
          'kind' in event &&
          event.kind === 'content' &&
          'delta' in event &&
          event.delta === '# Real'
        ) {
          sawFirstDelta()
        }
      }
    )

    await firstDelta
    expect(observed).toEqual([
      {
        kind: 'activity',
        event: {
          type: 'text',
          activityId: null,
          textId: 'plan:task-streaming',
          delta: '# Real'
        }
      },
      { kind: 'content', delta: '# Real' }
    ])

    releaseEnd()
    await expect(running).resolves.toMatchObject({
      status: 'completed',
      output: '# Real answer'
    })
    expect(observed).toEqual([
      {
        kind: 'activity',
        event: {
          type: 'text',
          activityId: null,
          textId: 'plan:task-streaming',
          delta: '# Real'
        }
      },
      { kind: 'content', delta: '# Real' },
      {
        kind: 'activity',
        event: {
          type: 'text',
          activityId: null,
          textId: 'plan:task-streaming',
          delta: ' answer'
        }
      },
      { kind: 'content', delta: ' answer' },
      {
        kind: 'end',
        content: '# Real answer',
        finishReason: 'stop',
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 }
      },
      {
        kind: 'activity',
        event: {
          type: 'text.done',
          activityId: null,
          textId: 'plan:task-streaming',
          phase: 'final'
        }
      }
    ])
  })

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
      goal: 'use a missing skill',
      model: modelRef
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

  it('rejects a model request for a Skill outside the task snapshot before provider execution', async () => {
    const execute = vi.fn<SkillProvider['execute']>(async ({ input }) => ({
      ok: true,
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
    const model: ModelGateway = {
      async complete() {
        return { kind: 'invoke-skill', skillId: 'browser-use', input: {} }
      }
    }

    const result = await new LangGraphRunner(model, { resolve: () => provider }).run({
      taskId: 'task-disabled-skill',
      goal: 'bypass the visible tools',
      model: modelRef,
      skills: []
    })

    expect(result).toMatchObject({
      status: 'failed',
      error: 'CAPABILITY_UNAVAILABLE: browser-use@1'
    })
    expect(execute).not.toHaveBeenCalled()
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
      goal: 'ask first',
      model: modelRef,
      skills: [{ skillId: 'browser-use', description: 'Operate a browser' }]
    })

    expect(result.status).toBe('waiting-user')
    expect(result.trace.at(-1)).toBe('awaitUser')
  })

  it('keeps LangGraph types out of shared domain contracts', async () => {
    const contractSources = await Promise.all([
      readFile(resolve(process.cwd(), 'packages/contracts/src/index.ts'), 'utf8'),
      readFile(resolve(process.cwd(), 'packages/runtime-contracts/src/runtime-event.ts'), 'utf8'),
      readFile(
        resolve(process.cwd(), 'packages/runtime-contracts/src/local-capability-protocol.ts'),
        'utf8'
      )
    ])

    expect(contractSources.join('\n')).not.toMatch(/@langchain\/(?:langgraph|core)/)
  })
})

const shellTool: ToolDefinition = {
  id: 'local.shell.run',
  version: 1,
  modelName: 'shell_run',
  description: 'Run a shell command',
  inputSchema: {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command'],
    additionalProperties: false
  },
  risk: 'high',
  sideEffects: { filesystem: 'write', network: true },
  timeoutMs: 1_000
}

function toolRunner(model: ModelGateway, executor: ToolExecutor) {
  const registry = new RuntimeToolRegistry()
  registry.register(shellTool, executor)
  const policy = new RuntimeToolPolicy()
  const commits: string[] = []
  const invocations = new ToolInvocationService({
    registry,
    policy,
    persistence: {
      async commitToolInvocationWithEvent(invocation, event) {
        commits.push(invocation.status)
        return { ...event, cursor: commits.length }
      }
    },
    clock: { now: () => new Date().toISOString() }
  })
  return {
    runner: new LangGraphRunner(model, new MockSkillRegistry(), undefined, {
      registry,
      policy,
      invocations,
      grants: ['local.shell.run@1']
    }),
    commits
  }
}
