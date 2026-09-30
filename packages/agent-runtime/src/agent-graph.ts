import {
  type BaseCheckpointSaver,
  Command,
  END,
  INTERRUPT,
  MemorySaver,
  START,
  StateGraph,
  interrupt as langGraphInterrupt,
  isInterrupted
} from '@langchain/langgraph'
import type { ModelRef } from '@action-driver/contracts'
import type { ToolDefinition } from '@action-driver/runtime-contracts'
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
import type { GraphToolRuntime } from './graph/tool-execution'
import { createExecuteToolsNode } from './graph/tool-execution'
import {
  AgentState,
  GRAPH_RECURSION_LIMIT,
  MAX_TOOL_CALLS,
  MAX_TOOL_ROUNDS,
  type AgentGraphRoute
} from './graph/state'
import {
  sessionInputNotice,
  stripVolatileScreenshotMessages,
  threadIdForTask,
  volatileScreenshotIds
} from './graph/helpers'

export type { GraphToolRuntime } from './graph/tool-execution'
export {
  threadIdForTask,
  sessionInputNotice,
  activityTitleForTool,
  activityTitleForTools
} from './graph/helpers'

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
      currentMessage?: RuntimeMessage
      systemPrompt?: string
      skills?: Array<{ skillId: string; description: string }>
      toolGrants?: string[]
      streamRequestId?: string
      inputContext?: Array<{ name: string; path: string; mimeType: string }>
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
            ...(request.inputContext?.length
              ? [{ role: 'system' as const, content: sessionInputNotice(request.inputContext) }]
              : []),
            ...(request.messages ?? []),
            request.currentMessage ?? { role: 'user' as const, content: request.goal }
          ],
          toolGrants: request.toolGrants ?? this.toolRuntime?.grants ?? [],
          toolRound: 0,
          toolCallCount: 0,
          activeActivityId: null,
          activityTitleRevision: 0,
          activityCapturesProgress: false,
          activityToolNames: [],
          activityIssueCount: 0,
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
        signal: controller.signal,
        recursionLimit: GRAPH_RECURSION_LIMIT
      })

      if (isInterrupted(state)) {
        const interrupted = this.toResult(state, taskId, 'waiting-user')
        return { ...interrupted, output: state[INTERRUPT][0]?.value ?? null }
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
        let plan: ModelResult
        let activityClosed = false
        try {
          const discoveredTools: ToolDefinition[] = this.toolRuntime
            ? this.toolRuntime.policy.discover(this.toolRuntime.registry.list(), {
                grants: state.toolGrants
              })
            : []
          const tools = this.toolRuntime?.isAvailable
            ? (
                await Promise.all(
                  discoveredTools.map(async (definition) =>
                    (await this.toolRuntime!.isAvailable!(definition)) ? definition : null
                  )
                )
              ).filter((definition): definition is ToolDefinition => definition !== null)
            : discoveredTools
          const capabilityNotice = await this.toolRuntime?.capabilityNotice?.()
          const request = {
            taskId: state.taskId,
            sessionId: state.sessionId,
            requestId: `plan:${state.taskId}${state.toolRound ? `:${state.toolRound}` : ''}`,
            model: state.model,
            messages: capabilityNotice
              ? [{ role: 'system' as const, content: capabilityNotice }, ...state.modelMessages]
              : state.modelMessages,
            ...(tools.length ? { tools } : {}),
            skills: state.skills,
            parameters: { temperature: 0 }
          }
          if (this.modelGateway.stream) {
            const streamed = await this.consumeModelStream(
              this.modelGateway.stream(request, config.signal),
              this.modelObservers.get(state.taskId),
              state.activeActivityId,
              request.requestId
            )
            plan = streamed.result
            activityClosed = streamed.activityClosed
          } else {
            plan = await this.modelGateway.complete(request, config.signal)
          }
        } catch (error) {
          if (config.signal?.aborted || this.isAbortError(error)) throw error
          return {
            status: 'failed' as const,
            modelMessages: stripVolatileScreenshotMessages(state.modelMessages),
            error: `MODEL_GATEWAY_ERROR: ${error instanceof Error ? error.message : String(error)}`,
            planRoute: 'skill' as const,
            trace: ['plan']
          }
        } finally {
          for (const id of volatileScreenshotIds(state.modelMessages))
            this.toolRuntime?.releaseVolatileImage?.(id)
        }

        const activeActivityId = activityClosed ? null : state.activeActivityId
        const retainedMessages = stripVolatileScreenshotMessages(state.modelMessages)
        if (plan.kind === 'finish') {
          if (activeActivityId) {
            await this.modelObservers.get(state.taskId)?.({
              kind: 'activity',
              event: { type: 'completed', activityId: activeActivityId }
            })
          }
          return {
            status: 'planned' as const,
            modelMessages: retainedMessages,
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
              modelMessages: retainedMessages,
              error: 'TOOL_CALLS_NOT_CONFIGURED',
              planRoute: 'skill' as const,
              trace: ['plan']
            }
          }
          if (
            state.toolRound >= MAX_TOOL_ROUNDS ||
            state.toolCallCount + plan.calls.length > MAX_TOOL_CALLS
          ) {
            return {
              status: 'failed' as const,
              modelMessages: retainedMessages,
              error: 'TOOL_BUDGET_EXCEEDED',
              planRoute: 'skill' as const,
              trace: ['plan']
            }
          }
          return {
            status: 'planned' as const,
            modelMessages: retainedMessages,
            pendingToolCalls: plan.calls,
            planRoute: 'tools' as const,
            activeActivityId,
            activityTitleRevision: activityClosed ? 0 : state.activityTitleRevision,
            activityToolNames: activityClosed ? [] : state.activityToolNames,
            activityIssueCount: activityClosed ? 0 : state.activityIssueCount,
            toolRound: state.toolRound + 1,
            toolCallCount: state.toolCallCount + plan.calls.length,
            trace: ['plan']
          }
        }

        return {
          status: 'planned' as const,
          modelMessages: retainedMessages,
          requestedSkillId: plan.skillId,
          skillInput: plan.input,
          planRoute: 'skill' as const,
          trace: ['plan']
        }
      })
      .addNode(
        'executeTools',
        createExecuteToolsNode({
          toolRuntime: this.toolRuntime,
          modelObserver: (taskId) => this.modelObservers.get(taskId),
          toolObserver: (taskId) => this.toolObservers.get(taskId),
          streamRequestId: (taskId) => this.streamRequestIds.get(taskId)
        })
      )
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
      .compile({ name: 'action-driver-agent-runtime', checkpointer: this.checkpointer })
  }

  private async consumeModelStream(
    events: AsyncIterable<ModelGatewayEvent>,
    observer?: ModelEventObserver,
    activityId: string | null = null,
    textId = 'plan'
  ): Promise<{ result: ModelResult; activityClosed: boolean }> {
    let terminal: ModelResult | null = null
    let hasText = false
    let activityClosed = false
    for await (const event of events) {
      if (event.kind === 'content' && event.delta) {
        if (activityId && !activityClosed) {
          await observer?.({ kind: 'activity', event: { type: 'completed', activityId } })
          activityClosed = true
        }
        hasText = true
        await observer?.({
          kind: 'activity',
          event: {
            type: 'text',
            activityId: activityClosed ? null : activityId,
            textId,
            delta: event.delta
          }
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
          activityId: activityClosed ? null : activityId,
          textId,
          phase: terminal.kind === 'finish' ? 'final' : 'process'
        }
      })
    }
    return { result: terminal, activityClosed }
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
