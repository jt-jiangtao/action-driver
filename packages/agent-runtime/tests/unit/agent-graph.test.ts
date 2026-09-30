import { MemorySaver } from '@langchain/langgraph'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition, ToolExecutor } from '@action-driver/runtime-contracts'
import {
  COMPUTER_USE_GUIDANCE_ERRORS,
  LangGraphRunner,
  RuntimeToolPolicy,
  RuntimeToolRegistry,
  RuntimeSkillRegistry,
  ToolInvocationService,
  threadIdForTask,
  type ModelGateway,
  type SkillProvider,
  type SkillRegistry
} from '../../src/index'
import { activityTitleForTool, activityTitleForTools } from '@action-driver/agent-runtime/agent-graph'
import { activityTitleForTools as groupTitleFromGraphHelpers } from '@action-driver/agent-runtime/graph/helpers'

const modelRef = { connectionId: 'connection-1', modelId: 'gpt-real' }

class MockSkillRegistry extends RuntimeSkillRegistry {
  constructor() {
    super()
    for (const [skillId, providerId] of [
      ['browser-use', 'mock.browser'],
      ['computer-use', 'mock.computer']
    ] as const) {
      this.register({
        skillId,
        providerId,
        providerVersion: '1.0.0',
        contractVersion: 1,
        async execute(request) {
          return { ok: true as const, providerId, input: request.input }
        }
      })
    }
  }
}

describe('minimal agent StateGraph', () => {
  it('exposes the same pure activity titles through the graph helpers boundary', () => {
    expect(groupTitleFromGraphHelpers).toBe(activityTitleForTools)
  })
  it('tells the model where the session inputs are before it plans', async () => {
    const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
    const model: ModelGateway = {
      async complete(request) {
        requests.push({ messages: request.messages as Array<{ role: string; content: unknown }> })
        return { kind: 'finish', content: '已读取' }
      }
    }
    const runner = new LangGraphRunner(model, new MockSkillRegistry())

    await runner.run({
      taskId: 'task-input-context',
      goal: '分析附件',
      model: modelRef,
      systemPrompt: 'Be concise.',
      inputContext: [
        {
          name: 'quarterly.pdf',
          path: '/tmp/workspace/sessions/session-1/input/quarterly.pdf',
          mimeType: 'application/pdf'
        }
      ]
    })

    expect(requests[0]?.messages).toEqual([
      { role: 'system', content: 'Be concise.' },
      {
        role: 'system',
        content:
          '本会话上传的文件已在工作目录内可直接读取（不要重新创建或猜测内容）：\n' +
          '- quarterly.pdf（application/pdf）: /tmp/workspace/sessions/session-1/input/quarterly.pdf'
      },
      { role: 'user', content: '分析附件' }
    ])
  })

  it('distinguishes shell commands from web search in group titles', () => {
    expect(activityTitleForTool('tools_local_command_shell_run')).toBe('正在执行命令')
    expect(activityTitleForTool('tools_local_web_search')).toBe('正在搜索网页')
    expect(activityTitleForTool('tools_local_web_open')).toBe('正在读取网页')
    expect(activityTitleForTool('js')).toBe('正在调用工具')
    expect(activityTitleForTool('js', 'failed')).toBe('调用工具失败')
    expect(activityTitleForTools('read pages', ['tools_local_web_open', 'tools_local_web_open'])).toBe(
      '正在执行 2 项网页读取'
    )
  })
  it('updates a mixed group summary as its tools and outcomes change', () => {
    const goal = '测试所有工具'
    expect(activityTitleForTools(goal, ['tools_local_command_shell_run', 'tools_local_command_python_run'])).toBe(
      '正在测试所有工具：命令、脚本'
    )
    expect(activityTitleForTools(goal, ['tools_local_command_shell_run', 'tools_local_command_python_run', 'tools_local_web_search'])).toBe(
      '正在测试所有工具：命令、脚本、网页'
    )
    expect(
      activityTitleForTools(goal, ['tools_local_command_shell_run', 'tools_local_command_python_run', 'tools_local_web_search'], 'completed', 1)
    ).toBe('测试所有工具：命令、脚本、网页')
    expect(
      activityTitleForTools(goal, ['tools_local_command_shell_run', 'tools_local_command_python_run', 'tools_local_web_search'], 'completed')
    ).toBe('已完成测试所有工具：命令、脚本、网页')
  })
  it('uses a concise task intent for a single tool and a homogeneous group', () => {
    const goal = '读取 README 的第一段'
    expect(activityTitleForTools(goal, ['tools_local_command_shell_run'])).toBe('正在读取 README 的第一段')
    expect(activityTitleForTools(goal, ['tools_local_command_shell_run', 'tools_local_command_shell_run'])).toBe(
      '正在读取 README 的第一段 · 2 条命令'
    )
    expect(activityTitleForTools(goal, ['tools_local_command_shell_run', 'tools_local_command_shell_run'], 'completed')).toBe(
      '已完成读取 README 的第一段 · 2 条命令'
    )
    expect(
      activityTitleForTools('在阻塞文件中查找 needle', ['sandbox_shell_run'], 'failed', 1)
    ).toBe('在阻塞文件中查找 needle（执行失败）')
  })
  it('rechecks image capability each model round without persisting a stale notice', async () => {
    let imageConfigured = false
    let round = 0
    const requests: Array<{
      messages: Array<{ role: string; content?: unknown }>
      tools?: ToolDefinition[]
    }> = []
    const imageTool: ToolDefinition = {
      ...shellTool,
      id: 'tools/local/image-generation/generate',
      modelName: 'tools_local_image_generation_generate',
      description: 'Generate an image'
    }
    const registry = new RuntimeToolRegistry()
    registry.register(shellTool, {
      async *execute() {
        imageConfigured = true
        yield { kind: 'result', output: 'ready' }
      }
    })
    registry.register(imageTool, {
      async *execute() {
        yield { kind: 'result', output: 'image' }
      }
    })
    const policy = new RuntimeToolPolicy()
    const invocations = new ToolInvocationService({
      registry,
      policy,
      persistence: {
        async commitToolInvocationWithEvent(_invocation, event) {
          return { ...event, cursor: 1 }
        }
      },
      clock: { now: () => new Date().toISOString() }
    })
    const model: ModelGateway = {
      async complete(request) {
        requests.push(request)
        round += 1
        return round === 1
          ? {
              kind: 'tool-calls',
              calls: [
                {
                  providerCallId: 'prepare',
                  modelName: 'tools_local_command_shell_run',
                  arguments: { command: 'true' }
                }
              ]
            }
          : { kind: 'finish', content: 'done' }
      }
    }
    const runner = new LangGraphRunner(model, new MockSkillRegistry(), undefined, {
      registry,
      policy,
      invocations,
      grants: ['tools/local/command/shell/run@1', 'tools/local/image-generation/generate@1'],
      isAvailable: async (definition) => definition.id !== 'tools/local/image-generation/generate' || imageConfigured,
      capabilityNotice: async () =>
        imageConfigured ? null : '生图功能未配置。请在设置 → 模型连接启用生图并设为默认模型。'
    })

    await runner.run({ taskId: 'task-image-capability', goal: '画一只猫', model: modelRef })

    expect(requests).toHaveLength(2)
    expect(requests[0]?.tools?.map((tool) => tool.modelName)).toEqual(['tools_local_command_shell_run'])
    expect(requests[0]?.messages.filter((message) => message.role === 'system')).toEqual([
      expect.objectContaining({ content: expect.stringContaining('设置 → 模型连接') })
    ])
    expect(requests[1]?.tools?.map((tool) => tool.modelName)).toEqual([
      'tools_local_command_shell_run',
      'tools_local_image_generation_generate'
    ])
    expect(
      requests[1]?.messages.some((message) => String(message.content).includes('生图功能未配置'))
    ).toBe(false)
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
          expect(request.tools?.map((tool) => tool.modelName)).toEqual(['tools_local_command_shell_run'])
          return {
            kind: 'tool-calls',
            calls: [
              {
                providerCallId: 'provider-read-first',
                modelName: 'tools_local_command_shell_run',
                arguments: { command: 'cat README.md' }
              },
              {
                providerCallId: 'provider-read-second',
                modelName: 'tools_local_command_shell_run',
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
                  modelName: 'tools_local_command_shell_run',
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
                  modelName: 'tools_local_command_shell_run',
                  arguments: { command: 'cat first.txt' }
                },
                {
                  providerCallId: 'second',
                  modelName: 'tools_local_command_shell_run',
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
        title: '已处理 2 条命令',
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
                modelName: 'tools_local_command_shell_run',
                arguments: { command: 'cat README.md' }
              },
              {
                providerCallId: 'provider-read-second',
                modelName: 'tools_local_command_shell_run',
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
                  modelName: 'tools_local_command_shell_run',
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
                  modelName: 'tools_local_command_shell_run',
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

  it('persists the Computer Use source for the model and for later turns', async () => {
    const source = 'nodeRepl.write("private-source-987")'
    let round = 0
    let received = ''
    let modelReceived = ''
    const model: ModelGateway = {
      async complete(request) {
        if (round++ === 0)
          return {
            kind: 'tool-calls',
            calls: [
              { providerCallId: 'private-call', modelName: 'js', arguments: { code: source } }
            ]
          }
        modelReceived = JSON.stringify(request.messages)
        return { kind: 'finish', content: 'done' }
      }
    }
    const registry = new RuntimeToolRegistry()
    registry.register(
      {
        ...shellTool,
        id: 'tools/local/cua/js',
        modelName: 'js',
        inputSchema: {
          type: 'object',
          properties: { code: { type: 'string' } },
          required: ['code']
        }
      },
      {
        async *execute(call) {
          received = String(call.arguments.code)
          yield { kind: 'result', output: { output: 'done' } }
        }
      }
    )
    const saver = new MemorySaver()
    const invocations = new ToolInvocationService({
      registry,
      policy: new RuntimeToolPolicy(),
      persistence: {
        async commitToolInvocationWithEvent(_invocation, event) {
          return { ...event, cursor: 1 }
        }
      },
      clock: { now: () => new Date().toISOString() }
    })
    const runner = new LangGraphRunner(model, new MockSkillRegistry(), saver, {
      registry,
      policy: new RuntimeToolPolicy(),
      invocations,
      grants: ['tools/local/cua/js@1']
    })
    const result = await runner.run({
      taskId: 'private-source-task',
      goal: 'run code',
      model: modelRef
    })
    expect(result.status).toBe('completed')
    expect(received).toBe(source)
    expect(modelReceived).toContain('private-source-987')
    const checkpoints = []
    for await (const checkpoint of saver.list({
      configurable: { thread_id: 'private-source-task' }
    }))
      checkpoints.push(checkpoint)
    expect(checkpoints.length).toBeGreaterThan(0)
    expect(JSON.stringify(checkpoints)).toContain('private-source-987')
  })

  it('hands the Computer Use skill gate failure back to the model without redacting it', async () => {
    let round = 0
    let modelReceived = ''
    const model: ModelGateway = {
      async complete(request) {
        if (round++ === 0)
          return {
            kind: 'tool-calls',
            calls: [
              {
                providerCallId: 'gate-call',
                modelName: 'js',
                arguments: { code: 'await cua.getState()' }
              }
            ]
          }
        modelReceived = JSON.stringify(request.messages)
        return { kind: 'finish', content: 'done' }
      }
    }
    const registry = new RuntimeToolRegistry()
    registry.register(
      {
        ...shellTool,
        id: 'tools/local/cua/js',
        modelName: 'js',
        inputSchema: {
          type: 'object',
          properties: { code: { type: 'string' } },
          required: ['code']
        }
      },
      {
        async *execute() {
          yield await Promise.reject(new Error(COMPUTER_USE_GUIDANCE_ERRORS.skillNotLoaded))
        },
        redactForPersistence: (kind) => (kind === 'input' ? { codeLength: 20 } : { outputLength: 0 })
      }
    )
    const invocations = new ToolInvocationService({
      registry,
      policy: new RuntimeToolPolicy(),
      persistence: {
        async commitToolInvocationWithEvent(_invocation, event) {
          return { ...event, cursor: 1 }
        }
      },
      clock: { now: () => new Date().toISOString() }
    })
    const runner = new LangGraphRunner(model, new MockSkillRegistry(), new MemorySaver(), {
      registry,
      policy: new RuntimeToolPolicy(),
      invocations,
      grants: ['tools/local/cua/js@1']
    })
    const result = await runner.run({
      taskId: 'gate-task',
      goal: 'use the computer',
      model: modelRef
    })
    expect(result.status).toBe('completed')
    expect(modelReceived).toContain(COMPUTER_USE_GUIDANCE_ERRORS.skillNotLoaded)
    expect(modelReceived).not.toContain('[redacted')
  })

  it('persists a failed Computer Use cell so the model and later turns keep the diagnostics', async () => {
    const documentation = 'Computer Use entry: call cua.getState() to see the current desktop'
    const failure = 'ReferenceError: sky is not defined'
    let round = 0
    let modelReceived = ''
    const model: ModelGateway = {
      async complete(request) {
        if (round++ === 0)
          return {
            kind: 'tool-calls',
            calls: [
              {
                providerCallId: 'failed-cell',
                modelName: 'js',
                arguments: { code: 'await sky.listApps()' }
              }
            ]
          }
        modelReceived = JSON.stringify(request.messages)
        return { kind: 'finish', content: 'done' }
      }
    }
    const registry = new RuntimeToolRegistry()
    registry.register(
      {
        ...shellTool,
        id: 'tools/local/cua/js',
        modelName: 'js',
        inputSchema: {
          type: 'object',
          properties: { code: { type: 'string' } },
          required: ['code']
        }
      },
      {
        async *execute() {
          yield { kind: 'content', stream: 'result', delta: documentation }
          yield await Promise.reject(new Error(failure))
        }
      }
    )
    const saver = new MemorySaver()
    const invocations = new ToolInvocationService({
      registry,
      policy: new RuntimeToolPolicy(),
      persistence: {
        async commitToolInvocationWithEvent(_invocation, event) {
          return { ...event, cursor: 1 }
        }
      },
      clock: { now: () => new Date().toISOString() }
    })
    const runner = new LangGraphRunner(model, new MockSkillRegistry(), saver, {
      registry,
      policy: new RuntimeToolPolicy(),
      invocations,
      grants: ['tools/local/cua/js@1']
    })
    const result = await runner.run({
      taskId: 'failed-cell-task',
      goal: 'use the computer',
      model: modelRef
    })
    expect(result.status).toBe('completed')
    expect(modelReceived).toContain(failure)
    expect(modelReceived).toContain(documentation)
    const checkpoints: unknown[] = []
    for await (const checkpoint of saver.list({
      configurable: { thread_id: 'failed-cell-task' }
    }))
      checkpoints.push(checkpoint)
    expect(JSON.stringify(checkpoints)).toContain(failure)
    expect(JSON.stringify(checkpoints)).toContain(documentation)
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
                modelName: 'tools_local_command_shell_run',
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
    expect(requests[0]?.tools?.map((tool) => tool.modelName)).toEqual(['tools_local_command_shell_run'])
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
                  modelName: 'tools_local_command_shell_run',
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
                modelName: 'tools_local_command_shell_run',
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
              { providerCallId: 'first', modelName: 'tools_local_command_shell_run', arguments: { command: 'cat a' } },
              { providerCallId: 'second', modelName: 'tools_local_command_shell_run', arguments: { command: 'cat b' } }
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
              modelName: 'tools_local_command_shell_run',
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
            modelName: 'tools_local_command_shell_run',
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
    const names = ['tools_local_command_shell_run', 'tools_local_command_python_run', 'tools_local_command_node_run', 'tools_local_web_search'] as const
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
        { ...shellTool, id: `test/${name}`, modelName: name },
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
      grants: names.map((name) => `test/${name}@1`)
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
              modelName: 'tools_local_command_shell_run',
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
            modelName: 'tools_local_command_shell_run',
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
              modelName: 'tools_local_command_shell_run',
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
  id: 'tools/local/command/shell/run',
  version: 1,
  modelName: 'tools_local_command_shell_run',
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
      grants: ['tools/local/command/shell/run@1']
    }),
    commits
  }
}

it('starts a new tool group once a generated image separates the work', async () => {
  const imageTool: ToolDefinition = {
    id: 'tools/local/image-generation/generate',
    version: 1,
    modelName: 'tools_local_image_generation_generate',
    description: 'Generate an image',
    inputSchema: {
      type: 'object',
      properties: { prompt: { type: 'string' } },
      required: ['prompt'],
      additionalProperties: false
    },
    risk: 'low',
    sideEffects: { filesystem: 'write', network: true },
    timeoutMs: 1_000
  }
  const observed: Array<{ type: string; activityId: string; title?: string }> = []
  let round = 0
  const model: ModelGateway = {
    async complete() {
      round += 1
      if (round === 1) {
        return {
          kind: 'tool-calls',
          calls: [
            {
              providerCallId: 'provider-image',
              modelName: 'tools_local_image_generation_generate',
              arguments: { prompt: '猫' }
            }
          ]
        }
      }
      if (round === 2) {
        return {
          kind: 'tool-calls',
          calls: [
            {
              providerCallId: 'provider-shell',
              modelName: 'tools_local_command_shell_run',
              arguments: { command: 'echo done' }
            }
          ]
        }
      }
      return { kind: 'finish', content: 'done' }
    }
  }
  const registry = new RuntimeToolRegistry()
  registry.register(imageTool, {
    async *execute() {
      yield {
        kind: 'asset',
        index: 0,
        asset: {
          assetId: 'asset-1',
          sessionId: 'session-1',
          mimeType: 'image/png',
          width: 8,
          height: 8,
          byteLength: 16,
          source: 'generated'
        }
      }
      yield { kind: 'result', output: 'generated' }
    }
  })
  registry.register(shellTool, {
    async *execute() {
      yield { kind: 'result', output: 'done' }
    }
  })
  const policy = new RuntimeToolPolicy()
  const invocations = new ToolInvocationService({
    registry,
    policy,
    persistence: {
      async commitToolInvocationWithEvent(_invocation, event) {
        return { ...event, cursor: 1 }
      }
    },
    clock: { now: () => new Date().toISOString() }
  })
  const runner = new LangGraphRunner(model, new MockSkillRegistry(), undefined, {
    registry,
    policy,
    invocations,
    grants: [
      'tools/local/command/shell/run@1',
      'tools/local/image-generation/generate@1'
    ]
  })

  await runner.run(
    { taskId: 'task-image-group', goal: '画图然后执行命令', model: modelRef },
    undefined,
    (event) => {
      if (typeof event === 'object' && event !== null && 'kind' in event && event.kind === 'activity')
        observed.push((event as { event: { type: string; activityId: string } }).event)
    }
  )

  const startedIds = observed.filter((entry) => entry.type === 'started').map((entry) => entry.activityId)
  expect(startedIds).toHaveLength(2)
  expect(new Set(startedIds).size).toBe(2)
  const firstCompleted = observed.findIndex(
    (entry) => entry.type === 'completed' && entry.activityId === startedIds[0]
  )
  const secondStarted = observed.findIndex(
    (entry) => entry.type === 'started' && entry.activityId === startedIds[1]
  )
  expect(firstCompleted).toBeGreaterThanOrEqual(0)
  expect(firstCompleted).toBeLessThan(secondStarted)
})

it('tells the model that crashed plugin side effects have an unknown outcome', async () => {
  const { PluginError } = await import('@action-driver/plugin-contracts')
  let round = 0, toolMessage: unknown
  const model: ModelGateway = { async complete(request) {
    if (round++ === 0) return { kind: 'tool-calls', calls: [{ providerCallId: 'p', modelName: 'tools_local_command_shell_run', arguments: { command: 'write' } }] }
    toolMessage = request.messages.find(message => message.role === 'tool')?.content
    return { kind: 'finish', content: 'Outcome uncertain; inspect before retrying.' }
  } }
  const { runner } = toolRunner(model, { async *execute() { yield* []; throw new PluginError('RESULT_UNKNOWN', 'Host exited after dispatch') } })
  await runner.run({ taskId: 'unknown-plugin', goal: 'write', model: modelRef })
  expect(String(toolMessage)).toContain('TOOL_OUTCOME_UNKNOWN')
  expect(String(toolMessage)).toContain('Host exited after dispatch')
  expect(String(toolMessage)).not.toContain('TOOL_NO_TERMINAL')
})
