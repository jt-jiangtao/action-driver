import {
  Annotation,
  type BaseCheckpointSaver,
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt as langGraphInterrupt,
  isInterrupted
} from '@langchain/langgraph'
import type { ModelRef } from '@actiondriver/contracts'
import type { ProviderToolCall } from '@actiondriver/model-connections'
import { parseToolCall, type ToolDefinition, type ToolEvent } from '@actiondriver/runtime-contracts'
import type { RuntimeToolRegistry } from './tool-registry'
import type { RuntimeToolPolicy } from './tool-policy'
import type { ToolInvocationService } from './tool-invocation-service'
import type {
  AgentGraphResult,
  GraphRunner,
  ModelEventObserver,
  ToolEventObserver,
  ModelGateway,
  ModelGatewayEvent,
  ModelResult,
  RuntimeMessage,
  SkillProviderResult,
  SkillRegistry
} from './ports'

type AgentGraphStatus =
  | 'submitted'
  | 'accepted'
  | 'planned'
  | 'skill-resolved'
  | 'skill-completed'
  | 'verified'
  | 'waiting-user'
  | 'completed'
  | 'failed'

type AgentGraphRoute = 'finish' | 'awaitUser' | 'failed'
type PlanRoute = 'tools' | 'skill'

export type GraphToolRuntime = {
  registry: RuntimeToolRegistry
  policy: RuntimeToolPolicy
  invocations: ToolInvocationService
  grants: string[]
}

const replace = <T>(_current: T, update: T): T => update

const AgentState = Annotation.Root({
  taskId: Annotation<string>(),
  sessionId: Annotation<string>(),
  threadId: Annotation<string>(),
  goal: Annotation<string>(),
  model: Annotation<ModelRef>(),
  systemPrompt: Annotation<string>({ reducer: replace, default: () => '' }),
  messages: Annotation<RuntimeMessage[]>({ reducer: replace, default: () => [] }),
  modelMessages: Annotation<RuntimeMessage[]>({ reducer: replace, default: () => [] }),
  toolGrants: Annotation<string[]>({ reducer: replace, default: () => [] }),
  toolRound: Annotation<number>({ reducer: replace, default: () => 0 }),
  toolCallCount: Annotation<number>({ reducer: replace, default: () => 0 }),
  activeActivityId: Annotation<string | null>({ reducer: replace, default: () => null }),
  activityTitleRevision: Annotation<number>({ reducer: replace, default: () => 0 }),
  activityCapturesProgress: Annotation<boolean>({ reducer: replace, default: () => false }),
  pendingToolCalls: Annotation<ProviderToolCall[]>({ reducer: replace, default: () => [] }),
  planRoute: Annotation<PlanRoute>({ reducer: replace, default: () => 'skill' }),
  skills: Annotation<Array<{ skillId: string; description: string }>>({
    reducer: replace,
    default: () => []
  }),
  status: Annotation<AgentGraphStatus>(),
  requestedSkillId: Annotation<string | null>({ reducer: replace, default: () => null }),
  resolvedProviderId: Annotation<string | null>({ reducer: replace, default: () => null }),
  providerVersion: Annotation<string | null>({ reducer: replace, default: () => null }),
  skillInput: Annotation<unknown>({ reducer: replace, default: () => null }),
  output: Annotation<unknown>({ reducer: replace, default: () => null }),
  error: Annotation<string | null>({ reducer: replace, default: () => null }),
  route: Annotation<AgentGraphRoute>({ reducer: replace, default: () => 'finish' }),
  trace: Annotation<string[]>({
    reducer: (current, update) => current.concat(update),
    default: () => []
  })
})

export function threadIdForTask(taskId: string): string {
  if (!taskId.trim()) throw new Error('Task id is required to create a LangGraph thread id')
  return taskId
}

export class LangGraphRunner implements GraphRunner {
  private readonly graph
  private readonly activeControllers = new Map<string, AbortController>()
  private readonly modelObservers = new Map<string, ModelEventObserver>()
  private readonly toolObservers = new Map<string, ToolEventObserver>()
  private readonly streamRequestIds = new Map<string, string>()

  constructor(
    private readonly modelGateway: ModelGateway,
    private readonly skillRegistry: SkillRegistry,
    private readonly checkpointer: BaseCheckpointSaver = new MemorySaver(),
    private readonly toolRuntime?: GraphToolRuntime
  ) {
    this.graph = this.createGraph()
  }

  async run(
    request: {
      taskId: string
      sessionId?: string
      goal: string
      model: ModelRef
      messages?: RuntimeMessage[]
      systemPrompt?: string
      skills?: Array<{ skillId: string; description: string }>
      toolGrants?: string[]
      streamRequestId?: string
    },
    signal?: AbortSignal,
    observer?: ModelEventObserver,
    toolObserver?: ToolEventObserver
  ): Promise<AgentGraphResult> {
    const threadId = threadIdForTask(request.taskId)
    if (observer) this.modelObservers.set(request.taskId, observer)
    if (toolObserver) this.toolObservers.set(request.taskId, toolObserver)
    if (request.streamRequestId) this.streamRequestIds.set(request.taskId, request.streamRequestId)
    try {
      const initialActivityId = defaultActivityId(request.taskId)
      await observer?.({
        kind: 'activity',
        event: {
          type: 'started',
          activityId: initialActivityId,
          title: '正在处理请求',
          titleRevision: 1
        }
      })
      return await this.execute(
        request.taskId,
        {
          taskId: request.taskId,
          sessionId: request.sessionId ?? request.taskId,
          threadId,
          goal: request.goal,
          model: request.model,
          systemPrompt: request.systemPrompt ?? '',
          messages: request.messages ?? [],
          modelMessages: [
            ...(request.systemPrompt?.trim()
              ? [{ role: 'system' as const, content: request.systemPrompt }]
              : []),
            ...(request.messages ?? []),
            { role: 'user' as const, content: request.goal }
          ],
          toolGrants: request.toolGrants ?? this.toolRuntime?.grants ?? [],
          toolRound: 0,
          toolCallCount: 0,
          activeActivityId: initialActivityId,
          activityTitleRevision: 1,
          activityCapturesProgress: false,
          pendingToolCalls: [],
          planRoute: 'skill',
          skills: request.skills ?? [],
          status: 'submitted',
          requestedSkillId: null,
          resolvedProviderId: null,
          providerVersion: null,
          skillInput: null,
          output: null,
          error: null,
          route: 'finish',
          trace: []
        },
        signal
      )
    } finally {
      if (observer && this.modelObservers.get(request.taskId) === observer) {
        this.modelObservers.delete(request.taskId)
      }
      if (toolObserver && this.toolObservers.get(request.taskId) === toolObserver) {
        this.toolObservers.delete(request.taskId)
      }
      this.streamRequestIds.delete(request.taskId)
    }
  }

  interrupt(taskId: string): boolean {
    const controller = this.activeControllers.get(taskId)
    if (!controller) return false
    controller.abort()
    return true
  }

  async provideInput(taskId: string, value: unknown): Promise<AgentGraphResult> {
    return this.execute(taskId, new Command({ resume: value }))
  }

  async continue(taskId: string): Promise<AgentGraphResult> {
    return this.execute(taskId, null as unknown as typeof AgentState.State)
  }

  private async execute(
    taskId: string,
    input: unknown,
    externalSignal?: AbortSignal
  ): Promise<AgentGraphResult> {
    const threadId = threadIdForTask(taskId)
    const controller = new AbortController()
    const abortFromExternal = () => controller.abort(externalSignal?.reason)
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
    this.activeControllers.set(taskId, controller)

    try {
      const state = await this.graph.invoke(input as Parameters<typeof this.graph.invoke>[0], {
        configurable: { thread_id: threadId },
        signal: controller.signal
      })

      if (isInterrupted(state)) {
        return this.toResult(state, taskId, 'waiting-user')
      }

      return this.toResult(state, taskId)
    } catch (error) {
      if (!controller.signal.aborted && !this.isAbortError(error)) throw error

      const snapshot = await this.graph.getState({ configurable: { thread_id: threadId } })
      return this.toResult(snapshot.values, taskId, 'interrupted')
    } finally {
      externalSignal?.removeEventListener('abort', abortFromExternal)
      if (this.activeControllers.get(taskId) === controller) this.activeControllers.delete(taskId)
    }
  }

  private toResult(
    state: Partial<typeof AgentState.State>,
    taskId: string,
    forcedStatus?: AgentGraphResult['status']
  ): AgentGraphResult {
    const trace = [...(state.trace ?? [])]
    if (forcedStatus === 'waiting-user' && trace.at(-1) !== 'awaitUser') trace.push('awaitUser')

    return {
      taskId: state.taskId ?? taskId,
      threadId: state.threadId ?? threadIdForTask(taskId),
      status:
        forcedStatus ??
        (state.status === 'completed'
          ? 'completed'
          : state.status === 'waiting-user'
            ? 'waiting-user'
            : 'failed'),
      output: state.output ?? null,
      error: state.error ?? null,
      trace
    }
  }

  private createGraph() {
    return new StateGraph(AgentState)
      .addNode('acceptGoal', (state) => ({
        threadId: threadIdForTask(state.taskId),
        status: 'accepted' as const,
        trace: ['acceptGoal']
      }))
      .addNode('plan', async (state, config) => {
        let plan
        try {
          const discoveredTools: ToolDefinition[] = this.toolRuntime
            ? this.toolRuntime.policy.discover(this.toolRuntime.registry.list(), {
                grants: state.toolGrants
              })
            : []
          const tools = discoveredTools
          const request = {
            taskId: state.taskId,
            sessionId: state.sessionId,
            requestId: `plan:${state.taskId}${state.toolRound ? `:${state.toolRound}` : ''}`,
            model: state.model,
            messages: state.modelMessages,
            ...(tools.length ? { tools } : {}),
            skills: state.skills,
            parameters: { temperature: 0 }
          }
          plan = this.modelGateway.stream
            ? await this.consumeModelStream(
                this.modelGateway.stream(request, config.signal),
                this.modelObservers.get(state.taskId),
                state.activeActivityId,
                request.requestId
              )
            : await this.modelGateway.complete(request, config.signal)
        } catch (error) {
          if (config.signal?.aborted || this.isAbortError(error)) throw error
          return {
            status: 'failed' as const,
            error: `MODEL_GATEWAY_ERROR: ${error instanceof Error ? error.message : String(error)}`,
            planRoute: 'skill' as const,
            trace: ['plan']
          }
        }

        if (plan.kind === 'finish') {
          if (state.activeActivityId) {
            await this.modelObservers.get(state.taskId)?.({
              kind: 'activity',
              event: { type: 'completed', activityId: state.activeActivityId }
            })
          }
          return {
            status: 'planned' as const,
            output: plan.content,
            requestedSkillId: null,
            planRoute: 'skill' as const,
            activeActivityId: null,
            trace: ['plan']
          }
        }

        if (plan.kind === 'tool-calls') {
          if (plan.calls.length > 0 && !this.toolRuntime) {
            return {
              status: 'failed' as const,
              error: 'TOOL_CALLS_NOT_CONFIGURED',
              planRoute: 'skill' as const,
              trace: ['plan']
            }
          }
          if (state.toolRound >= 8 || state.toolCallCount + plan.calls.length > 16) {
            return {
              status: 'failed' as const,
              error: 'TOOL_BUDGET_EXCEEDED',
              planRoute: 'skill' as const,
              trace: ['plan']
            }
          }
          return {
            status: 'planned' as const,
            pendingToolCalls: plan.calls,
            planRoute: 'tools' as const,
            toolRound: state.toolRound + 1,
            toolCallCount: state.toolCallCount + plan.calls.length,
            trace: ['plan']
          }
        }

        return {
          status: 'planned' as const,
          requestedSkillId: plan.skillId,
          skillInput: plan.input,
          planRoute: 'skill' as const,
          trace: ['plan']
        }
      })
      .addNode('executeTools', async (state, config) => {
        const results: RuntimeMessage[] = []
        let activeActivityId = state.activeActivityId
        let activityTitleRevision = state.activityTitleRevision
        let activityCapturesProgress = state.activityCapturesProgress
        for (const [index, providerCall] of state.pendingToolCalls.entries()) {
          if (config.signal?.aborted) throw config.signal.reason
          if (!this.toolRuntime) {
            return { error: 'TOOL_CALLS_NOT_CONFIGURED', trace: ['executeTools'] }
          }
          const toolTitle = activityTitleForTool(providerCall.modelName)
          if (activeActivityId) {
            activityTitleRevision += 1
            await this.modelObservers.get(state.taskId)?.({
              kind: 'activity',
              event: {
                type: 'updated',
                activityId: activeActivityId,
                title: toolTitle,
                titleRevision: activityTitleRevision
              }
            })
          } else {
            activeActivityId = nextActivityId(state.taskId, state.toolRound, index)
            activityTitleRevision = 1
            activityCapturesProgress = false
            await this.modelObservers.get(state.taskId)?.({
              kind: 'activity',
              event: {
                type: 'started',
                activityId: activeActivityId,
                title: toolTitle,
                titleRevision: activityTitleRevision
              }
            })
          }
          const call = parseToolCall({
            callId: `tool:${state.taskId}:${state.toolRound}:${index}`,
            providerCallId: providerCall.providerCallId,
            modelName: providerCall.modelName,
            arguments: providerCall.arguments
          })
          let terminal: Extract<
            ToolEvent,
            { type: 'tool.completed' | 'tool.failed' | 'tool.cancelled' }
          > | null = null
          try {
            for await (const toolEvent of this.toolRuntime.invocations.execute(
              call,
              {
                taskId: state.taskId,
                threadId: state.threadId,
                checkpointId: `tool:${state.toolRound}`,
                requestId:
                  this.streamRequestIds.get(state.taskId) ??
                  `plan:${state.taskId}:${state.toolRound}`,
                grants: state.toolGrants,
                activityId: activeActivityId,
                ...(this.toolObservers.get(state.taskId)
                  ? { onEvent: this.toolObservers.get(state.taskId)! }
                  : {})
              },
              config.signal
            )) {
              if (
                toolEvent.type === 'tool.completed' ||
                toolEvent.type === 'tool.failed' ||
                toolEvent.type === 'tool.cancelled'
              ) {
                terminal = toolEvent
              }
            }
          } catch (error) {
            if (config.signal?.aborted) throw error
            terminal = {
              type: 'tool.failed',
              callId: call.callId,
              taskId: state.taskId,
              sequence: 0,
              error: {
                code:
                  error instanceof Error && 'code' in error
                    ? String(error.code)
                    : 'TOOL_UNAVAILABLE',
                message: error instanceof Error ? error.message : String(error),
                retryable: false
              }
            }
          }
          results.push({
            role: 'tool',
            toolCallId: providerCall.providerCallId,
            name: providerCall.modelName,
            content: JSON.stringify(
              terminal?.type === 'tool.completed'
                ? { ok: true, output: terminal.output }
                : {
                    ok: false,
                    error:
                      terminal?.type === 'tool.failed' || terminal?.type === 'tool.cancelled'
                        ? terminal.error
                        : { code: 'TOOL_NO_TERMINAL' }
                  }
            )
          })
        }
        return {
          modelMessages: [
            ...state.modelMessages,
            { role: 'assistant' as const, toolCalls: state.pendingToolCalls },
            ...results
          ],
          pendingToolCalls: [],
          activeActivityId,
          activityTitleRevision,
          activityCapturesProgress,
          trace: ['executeTools']
        }
      })
      .addNode('resolveSkill', (state) => {
        if (state.error) {
          return { status: 'failed' as const, trace: ['resolveSkill'] }
        }

        if (!state.requestedSkillId) {
          return { status: 'skill-completed' as const, trace: ['resolveSkill'] }
        }

        if (!state.skills.some((skill) => skill.skillId === state.requestedSkillId)) {
          return {
            status: 'failed' as const,
            error: `CAPABILITY_UNAVAILABLE: ${state.requestedSkillId}@1`,
            trace: ['resolveSkill']
          }
        }

        try {
          const provider = this.skillRegistry.resolve(state.requestedSkillId, 1)
          return {
            status: 'skill-resolved' as const,
            resolvedProviderId: provider.providerId,
            providerVersion: provider.providerVersion,
            trace: ['resolveSkill']
          }
        } catch (error) {
          return {
            status: 'failed' as const,
            error: error instanceof Error ? error.message : String(error),
            trace: ['resolveSkill']
          }
        }
      })
      .addNode('invokeSkill', async (state, config) => {
        if (state.error) {
          return { status: 'failed' as const, trace: ['invokeSkill'] }
        }

        if (!state.requestedSkillId) {
          return { status: 'skill-completed' as const, trace: ['invokeSkill'] }
        }

        try {
          const provider = this.skillRegistry.resolve(state.requestedSkillId, 1)
          const output = await provider.execute(
            {
              invocationId: `skill:${state.taskId}`,
              input: state.skillInput
            },
            config.signal
          )
          return { status: 'skill-completed' as const, output, trace: ['invokeSkill'] }
        } catch (error) {
          return {
            status: 'failed' as const,
            error: error instanceof Error ? error.message : String(error),
            trace: ['invokeSkill']
          }
        }
      })
      .addNode('verifyOutcome', (state) => ({
        status: state.error ? ('failed' as const) : ('verified' as const),
        route: this.routeAfterVerification(state.output, state.error),
        trace: ['verifyOutcome']
      }))
      .addNode('awaitUser', (state) => {
        const userInput = langGraphInterrupt({
          taskId: state.taskId,
          reason: 'skill-needs-user'
        })
        return { status: 'verified' as const, output: userInput, trace: ['awaitUser'] }
      })
      .addNode('finish', () => ({ status: 'completed' as const, trace: ['finish'] }))
      .addNode('failed', () => ({ status: 'failed' as const, trace: ['failed'] }))
      .addEdge(START, 'acceptGoal')
      .addEdge('acceptGoal', 'plan')
      .addConditionalEdges('plan', (state) => state.planRoute, {
        tools: 'executeTools',
        skill: 'resolveSkill'
      })
      .addEdge('executeTools', 'plan')
      .addEdge('resolveSkill', 'invokeSkill')
      .addEdge('invokeSkill', 'verifyOutcome')
      .addConditionalEdges('verifyOutcome', (state) => state.route, {
        finish: 'finish',
        awaitUser: 'awaitUser',
        failed: 'failed'
      })
      .addEdge('awaitUser', 'finish')
      .addEdge('finish', END)
      .addEdge('failed', END)
      .compile({ name: 'actiondriver-agent-runtime', checkpointer: this.checkpointer })
  }

  private async consumeModelStream(
    events: AsyncIterable<ModelGatewayEvent>,
    observer?: ModelEventObserver,
    activityId: string | null = null,
    textId = 'plan'
  ): Promise<ModelResult> {
    let terminal: ModelResult | null = null
    let hasText = false
    for await (const event of events) {
      if (event.kind === 'content' && event.delta) {
        hasText = true
        await observer?.({
          kind: 'activity',
          event: { type: 'text', activityId, textId, delta: event.delta }
        })
      }
      await observer?.(event)
      if (event.kind === 'end') {
        terminal =
          event.result?.kind === 'tool-calls'
            ? { kind: 'tool-calls', calls: event.result.calls }
            : { kind: 'finish', content: event.content }
      }
    }
    if (!terminal) throw new Error('Model stream ended without a terminal event')
    if (hasText) {
      await observer?.({
        kind: 'activity',
        event: {
          type: 'text.done',
          activityId,
          textId,
          phase: terminal.kind === 'finish' ? 'final' : 'process'
        }
      })
    }
    return terminal
  }

  private routeAfterVerification(output: unknown, error: string | null): AgentGraphRoute {
    if (error) return 'failed'
    if (this.needsUser(output)) return 'awaitUser'
    return 'finish'
  }

  private needsUser(output: unknown): output is SkillProviderResult & { needsUser: true } {
    return (
      typeof output === 'object' &&
      output !== null &&
      'needsUser' in output &&
      output.needsUser === true
    )
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError'
  }
}

function defaultActivityId(taskId: string): string {
  return `activity:${taskId}:default`
}

function nextActivityId(taskId: string, toolRound: number, index: number): string {
  return `activity:${taskId}:tools:${toolRound}:${index}`
}

function activityTitleForTool(modelName: string): string {
  const normalized = modelName.toLowerCase()
  if (normalized.includes('web') || normalized.includes('search')) return '正在搜索网页'
  if (normalized.includes('shell') || normalized.includes('command')) return '正在执行命令'
  if (normalized.includes('file') || normalized.includes('fs_') || normalized.includes('fs.')) {
    return '正在读取文件'
  }
  return '正在调用工具'
}
