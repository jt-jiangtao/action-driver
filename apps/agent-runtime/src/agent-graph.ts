import {
  Annotation,
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
import type { ImageAssetRef, ModelRef } from '@actiondriver/contracts'
import type { ProviderToolCall } from '@actiondriver/model-connections'
import { parseToolCall, type ToolDefinition, type ToolEvent } from '@actiondriver/runtime-contracts'
import { classifyCellActions } from './computer-use/cell-actions'
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
import { redactCollectedOutput, type ToolRedaction } from './tool-result-redaction'

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

function isVolatileComputerImage(value: unknown): value is ImageAssetRef {
  if (typeof value !== 'object' || value === null) return false
  const image = value as Partial<ImageAssetRef>
  return typeof image.assetId === 'string' && image.assetId.startsWith('volatile-computer:') &&
    image.sessionId === 'computer-use' && image.mimeType === 'image/jpeg' &&
    typeof image.width === 'number' && typeof image.height === 'number' &&
    typeof image.byteLength === 'number' && image.source === 'upload'
}

function stripVolatileScreenshotMessages(messages: RuntimeMessage[]): RuntimeMessage[] {
  return messages.filter((message) => {
    if (message.role !== 'user' || !Array.isArray(message.content)) return true
    return !message.content.some((part) => part.kind === 'image' &&
      part.asset.assetId.startsWith('volatile-computer:'))
  })
}

function volatileScreenshotIds(messages: RuntimeMessage[]): string[] {
  return messages.flatMap((message) => message.role === 'user' && Array.isArray(message.content)
    ? message.content.flatMap((part) => part.kind === 'image' &&
      part.asset.assetId.startsWith('volatile-computer:') ? [part.asset.assetId] : [])
    : [])
}

function volatileToolResultKey(taskId: string, toolCallId: string): string {
  return `${taskId}\u0000${toolCallId}`
}

/** What the user is asked to confirm before a call runs, or null when it runs unprompted. */
type ComputerApprovalRequest =
  | { kind: 'action'; action: Record<string, unknown>; observationId: string }
  | { kind: 'cell'; cell: { title?: string; code: string; codeLength: number; actions: string[] } }

/** Longest code excerpt sent with an approval prompt; the full source stays in the tool record. */
const APPROVAL_CODE_EXCERPT = 1_200

function computerApprovalRequest(call: ProviderToolCall): ComputerApprovalRequest | null {
  if (call.modelName === 'computer_act') {
    const action = call.arguments.action
    if (typeof action !== 'object' || action === null || !('type' in action)) {
      return { kind: 'action', action: {}, observationId: String(call.arguments.observationId ?? '') }
    }
    if (action.type === 'wait' || action.type === 'scroll') return null
    return { kind: 'action', action: action as Record<string, unknown>,
      observationId: String(call.arguments.observationId ?? '') }
  }
  // The JavaScript entry runs the whole Skill API, so the confirmation belongs to the cell: ask once
  // before running code that can change the desktop, and let observation-only cells run untouched.
  if (call.modelName === 'js') {
    const code = typeof call.arguments.code === 'string' ? call.arguments.code : ''
    const classified = classifyCellActions(code)
    if (!classified.acts) return null
    const title = call.arguments.title
    return { kind: 'cell', cell: {
      ...(typeof title === 'string' && title.trim() ? { title } : {}),
      code: code.slice(0, APPROVAL_CODE_EXCERPT),
      codeLength: code.length,
      actions: classified.methods
    } }
  }
  return null
}

export type GraphToolRuntime = {
  registry: RuntimeToolRegistry
  policy: RuntimeToolPolicy
  invocations: ToolInvocationService
  grants: string[]
  isAvailable?: (definition: ToolDefinition) => Promise<boolean>
  capabilityNotice?: () => Promise<string | null>
  releaseVolatileImage?: (assetId: string) => void
}

const MAX_TOOL_CALLS = 512
const MAX_TOOL_ROUNDS = 512
const GRAPH_RECURSION_LIMIT = MAX_TOOL_ROUNDS * 2 + 16

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
  activityToolNames: Annotation<string[]>({ reducer: replace, default: () => [] }),
  activityIssueCount: Annotation<number>({ reducer: replace, default: () => 0 }),
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

export function sessionInputNotice(
  files: ReadonlyArray<{ name: string; path: string; mimeType: string }>
): string {
  return [
    '本会话上传的文件已在工作目录内可直接读取（不要重新创建或猜测内容）：',
    ...files.map((file) => `- ${file.name}（${file.mimeType}）: ${file.path}`)
  ].join('\n')
}

export class LangGraphRunner implements GraphRunner {
  private readonly graph
  private readonly activeControllers = new Map<string, AbortController>()
  private readonly modelObservers = new Map<string, ModelEventObserver>()
  private readonly toolObservers = new Map<string, ToolEventObserver>()
  private readonly streamRequestIds = new Map<string, string>()
  /**
   * Full results of redacting tools (Computer Use element trees), keyed by task and tool call.
   * Graph state and therefore checkpoints hold only the redacted summary; the full text is
   * resolved into the next model request and then dropped, like volatile screenshots.
   */
  private readonly volatileToolResults = new Map<string, string>()

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
    let waitingForUser = false

    try {
      const state = await this.graph.invoke(input as Parameters<typeof this.graph.invoke>[0], {
        configurable: { thread_id: threadId },
        signal: controller.signal,
        recursionLimit: GRAPH_RECURSION_LIMIT
      })

      if (isInterrupted(state)) {
        waitingForUser = true
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
      // A finished, failed or interrupted run never resumes a model request that would consume
      // the in-memory results; only a run waiting for the user keeps them.
      if (!waitingForUser) this.dropVolatileToolResults(taskId)
    }
  }

  private toolRedaction(modelName: string): ToolRedaction | undefined {
    try {
      const { executor } = this.toolRuntime!.registry.resolveModelName(modelName)
      return executor.redactForPersistence?.bind(executor)
    } catch {
      return undefined
    }
  }

  /** Puts full in-memory tool results back for the model; checkpointed state keeps summaries. */
  private resolveVolatileToolResults(taskId: string, messages: RuntimeMessage[]): RuntimeMessage[] {
    if (this.volatileToolResults.size === 0) return messages
    return messages.map((message) => {
      if (message.role !== 'tool') return message
      const full = this.volatileToolResults.get(volatileToolResultKey(taskId, message.toolCallId))
      return full === undefined ? message : { ...message, content: full }
    })
  }

  private dropVolatileToolResults(taskId: string): void {
    const prefix = volatileToolResultKey(taskId, '')
    for (const key of this.volatileToolResults.keys())
      if (key.startsWith(prefix)) this.volatileToolResults.delete(key)
  }

  private releaseVolatileToolResults(taskId: string, messages: RuntimeMessage[]): void {
    for (const message of messages) {
      if (message.role === 'tool')
        this.volatileToolResults.delete(volatileToolResultKey(taskId, message.toolCallId))
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
              ? [{ role: 'system' as const, content: capabilityNotice },
                  ...this.resolveVolatileToolResults(state.taskId, state.modelMessages)]
              : this.resolveVolatileToolResults(state.taskId, state.modelMessages),
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
          this.releaseVolatileToolResults(state.taskId, state.modelMessages)
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
      .addNode('executeTools', async (state, config) => {
        const results: RuntimeMessage[] = []
        const screenshots: ImageAssetRef[] = []
        const approval = state.pendingToolCalls
          .map((call) => ({ call, request: computerApprovalRequest(call) }))
          .find((entry) => entry.request !== null) ?? null
        const approvalCall = approval?.call ?? null
        let approved = true
        if (approvalCall) {
          if (state.pendingToolCalls.length !== 1)
            throw new Error('COMPUTER_ACTION_BATCH_UNSUPPORTED: call one modifying action at a time')
          const request = approval!.request!
          const decision = langGraphInterrupt({
            reason: 'computer-action-approval', taskId: state.taskId,
            providerCallId: approvalCall.providerCallId,
            ...(request.kind === 'action'
              ? { action: request.action, observationId: request.observationId }
              : { cell: request.cell })
          }) as unknown
          approved = typeof decision === 'object' && decision !== null &&
            'approved' in decision && decision.approved === true &&
            'providerCallId' in decision && decision.providerCallId === approvalCall.providerCallId
        }
        let activeActivityId = state.activeActivityId
        let activityTitleRevision = state.activityTitleRevision
        let activityCapturesProgress = state.activityCapturesProgress
        let activityToolNames = state.activityToolNames
        let activityIssueCount = state.activityIssueCount
        for (const [index, providerCall] of state.pendingToolCalls.entries()) {
          if (config.signal?.aborted) throw config.signal.reason
          if (!this.toolRuntime) {
            return { error: 'TOOL_CALLS_NOT_CONFIGURED', trace: ['executeTools'] }
          }
          activityToolNames = [...activityToolNames, providerCall.modelName]
          const toolTitle = activityTitleForTools(state.goal, activityToolNames)
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
            activeActivityId =
              state.toolRound === 1 && index === 0
                ? defaultActivityId(state.taskId)
                : nextActivityId(state.taskId, state.toolRound, index)
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
          if (providerCall === approvalCall && !approved) {
            results.push({ role: 'tool', toolCallId: providerCall.providerCallId,
              name: providerCall.modelName,
              content: JSON.stringify({ ok: false, error: {
                code: 'USER_DENIED', message: 'The user declined this Computer Use action'
              } }) })
            activityIssueCount += 1
            continue
          }
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
          const redact = terminal?.type === 'tool.completed'
            ? this.toolRedaction(providerCall.modelName)
            : undefined
          if (redact && terminal?.type === 'tool.completed') {
            this.volatileToolResults.set(
              volatileToolResultKey(state.taskId, providerCall.providerCallId),
              JSON.stringify({ ok: true, output: terminal.output })
            )
          }
          results.push({
            role: 'tool',
            toolCallId: providerCall.providerCallId,
            name: providerCall.modelName,
            content: JSON.stringify(
              terminal?.type === 'tool.completed'
                ? {
                    ok: true,
                    output: redact ? redactCollectedOutput(redact, terminal.output) : terminal.output
                  }
                : {
                    ok: false,
                    error:
                      terminal?.type === 'tool.failed' || terminal?.type === 'tool.cancelled'
                        ? terminal.error
                        : { code: 'TOOL_NO_TERMINAL' }
                  }
            )
          })
          if (providerCall.modelName === 'computer_capture' && terminal?.type === 'tool.completed') {
            const output = terminal.output as { result?: { screenshot?: unknown } }
            const asset = output?.result?.screenshot
            if (isVolatileComputerImage(asset)) screenshots.push(asset)
          }
          if (terminal?.type !== 'tool.completed') activityIssueCount += 1
          activityTitleRevision += 1
          await this.modelObservers.get(state.taskId)?.({
            kind: 'activity',
            event: {
              type: 'updated',
              activityId: activeActivityId,
              title: activityTitleForTools(
                state.goal,
                activityToolNames,
                terminal?.type === 'tool.completed'
                  ? 'completed'
                  : terminal?.type === 'tool.cancelled'
                    ? 'cancelled'
                    : 'failed',
                activityIssueCount
              ),
              titleRevision: activityTitleRevision
            }
          })
        }
        return {
          modelMessages: [
            ...state.modelMessages,
            { role: 'assistant' as const, toolCalls: state.pendingToolCalls },
            ...results,
            ...screenshots.map((asset): RuntimeMessage => ({
              role: 'user',
              content: [
                { kind: 'text', text: 'Current desktop screenshot. Use its matching observation ID for the next action.' },
                { kind: 'image', asset }
              ]
            }))
          ],
          pendingToolCalls: [],
          activeActivityId,
          activityTitleRevision,
          activityCapturesProgress,
          activityToolNames,
          activityIssueCount,
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

function defaultActivityId(taskId: string): string {
  return `activity:${taskId}:default`
}

function nextActivityId(taskId: string, toolRound: number, index: number): string {
  return `activity:${taskId}:tools:${toolRound}:${index}`
}

export function activityTitleForTool(
  modelName: string,
  status: 'running' | 'completed' | 'failed' | 'cancelled' = 'running'
): string {
  const normalized = modelName.toLowerCase()
  const action =
    normalized === 'web_open'
      ? '读取网页'
      : normalized.includes('web')
        ? '搜索网页'
        : normalized.includes('shell') || normalized.includes('command')
          ? '执行命令'
          : normalized.includes('python')
            ? '运行 Python'
            : normalized.includes('ts_run') || normalized.includes('typescript')
              ? '运行 TypeScript'
              : normalized.includes('node_run') || normalized.includes('node.run')
                ? '运行 Node.js'
                : '调用工具'
  if (status === 'running') return `正在${action}`
  if (status === 'completed') return `已${action}`
  if (status === 'cancelled') return `已取消${action}`
  return `${action}失败`
}

export function activityTitleForTools(
  goal: string,
  modelNames: string[],
  status: 'running' | 'completed' | 'failed' | 'cancelled' = 'running',
  issueCount = 0
): string {
  const kinds = new Set(modelNames.map(activityToolKind))
  const count = modelNames.length
  const category = [...kinds]
    .map((kind) =>
      kind === 'web' ? '网页' : kind === 'shell' ? '命令' : kind === 'script' ? '脚本' : '其他工具'
    )
    .join('、')
  const firstSentence = goal
    .trim()
    .replace(/\s+/g, ' ')
    .split(/[。！？\n]/)[0]
    ?.trim()
  const shortGoal = firstSentence?.replace(/[，,；;:：]$/, '')
  if (shortGoal && /[\u3400-\u9fff]/.test(shortGoal) && shortGoal.length <= 24) {
    const detail =
      count === 1
        ? ''
        : kinds.size > 1
          ? `：${category}`
          : ` · ${count} ${kinds.has('shell') ? '条命令' : '项操作'}`
    const summary = `${shortGoal}${detail}`
    if (status === 'running') return `正在${summary}`
    if (status === 'failed' && count === 1) return `${summary}（执行失败）`
    if (status === 'cancelled' && count === 1) return `${summary}（已取消）`
    // A group with unfinished work keeps the neutral plan wording: failures are
    // visible on the individual tool rows, not as a count in the title.
    if (issueCount > 0) return summary
    if (status === 'completed') return `已完成${summary}`
    if (status === 'cancelled') return `已取消${summary}`
    return `${summary}失败`
  }
  if (count === 1) return activityTitleForTool(modelNames[0]!, status)
  if (kinds.size > 1) {
    const summary = `使用${category}工具`
    if (status === 'running') return `正在${summary}`
    if (issueCount > 0) return summary
    if (status === 'completed') return `已完成${summary}`
    if (status === 'cancelled') return `已取消${summary}`
    return `${summary}失败`
  }
  const subject =
    kinds.size === 1 && kinds.has('web')
      ? `${count} 项${
          modelNames.every((name) => name.toLowerCase() === 'web_open')
            ? '网页读取'
            : modelNames.every((name) => name.toLowerCase() === 'web_search')
              ? '网页搜索'
              : '网页操作'
        }`
      : kinds.size === 1 && kinds.has('shell')
        ? `${count} 条命令`
        : `${count} 项操作`
  if (status === 'running') return `正在执行 ${subject}`
  if (issueCount > 0) return `已处理 ${subject}`
  if (status === 'completed') return `已执行 ${subject}`
  if (status === 'cancelled') return `已取消 ${subject}`
  return `${subject}执行失败`
}

function activityToolKind(modelName: string): 'web' | 'shell' | 'script' | 'other' {
  const normalized = modelName.toLowerCase()
  if (normalized.includes('web')) return 'web'
  if (normalized.includes('shell') || normalized.includes('command')) return 'shell'
  if (
    normalized.includes('python') ||
    normalized.includes('ts_run') ||
    normalized.includes('typescript') ||
    normalized.includes('node_run') ||
    normalized.includes('node.run')
  )
    return 'script'
  return 'other'
}
