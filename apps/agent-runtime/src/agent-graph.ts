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
import type {
  AgentGraphResult,
  GraphRunner,
  ModelGateway,
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

const replace = <T>(_current: T, update: T): T => update

const AgentState = Annotation.Root({
  taskId: Annotation<string>(),
  threadId: Annotation<string>(),
  goal: Annotation<string>(),
  model: Annotation<ModelRef>(),
  systemPrompt: Annotation<string>({ reducer: replace, default: () => '' }),
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

  constructor(
    private readonly modelGateway: ModelGateway,
    private readonly skillRegistry: SkillRegistry,
    private readonly checkpointer: BaseCheckpointSaver = new MemorySaver()
  ) {
    this.graph = this.createGraph()
  }

  async run(
    request: {
      taskId: string
      goal: string
      model: ModelRef
      systemPrompt?: string
      skills?: Array<{ skillId: string; description: string }>
    },
    signal?: AbortSignal
  ): Promise<AgentGraphResult> {
    const threadId = threadIdForTask(request.taskId)
    return this.execute(
      request.taskId,
      {
        taskId: request.taskId,
        threadId,
        goal: request.goal,
        model: request.model,
        systemPrompt: request.systemPrompt ?? '',
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
          plan = await this.modelGateway.complete(
            {
              taskId: state.taskId,
              requestId: `plan:${state.taskId}`,
              model: state.model,
              messages: [
                ...(state.systemPrompt.trim()
                  ? [{ role: 'system' as const, content: state.systemPrompt }]
                  : []),
                { role: 'user' as const, content: state.goal }
              ],
              skills: state.skills,
              parameters: { temperature: 0 }
            },
            config.signal
          )
        } catch (error) {
          if (config.signal?.aborted || this.isAbortError(error)) throw error
          return {
            status: 'failed' as const,
            error: `MODEL_GATEWAY_ERROR: ${error instanceof Error ? error.message : String(error)}`,
            trace: ['plan']
          }
        }

        if (plan.kind === 'finish') {
          return {
            status: 'planned' as const,
            output: plan.content,
            requestedSkillId: null,
            trace: ['plan']
          }
        }

        return {
          status: 'planned' as const,
          requestedSkillId: plan.skillId,
          skillInput: plan.input,
          trace: ['plan']
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
      .addEdge('plan', 'resolveSkill')
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
