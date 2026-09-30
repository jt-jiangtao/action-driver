import type { Clock, SkillProvider, SkillProviderResult, SkillRegistry } from './ports'
import type { PersistedSkillInvocation } from './repositories'
import type { RuntimeEventRecord } from './ports'
import {
  SkillInvocationStateMachine,
  type SkillInvocationState
} from './skill-invocation-state-machine'

export type ExecuteSkillRequest = {
  invocationId: string
  taskId: string
  checkpointId: string
  requestedSkillId: string
  contractVersion: number
  input: unknown
}

/** The only persistence this service needs: its own invocation plus the event it emits. */
export type SkillInvocationPersistence = {
  commitSkillInvocationWithEvent(
    invocation: PersistedSkillInvocation,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord>
}

export class SkillInvocationService {
  private readonly active = new Map<
    string,
    { provider: SkillProvider; completion: Promise<void> }
  >()

  constructor(
    private readonly registry: SkillRegistry,
    private readonly repositories: SkillInvocationPersistence,
    private readonly clock: Clock
  ) {}

  async execute(request: ExecuteSkillRequest, signal?: AbortSignal): Promise<SkillProviderResult> {
    const provider = this.registry.resolve(request.requestedSkillId, request.contractVersion)
    const timestamp = this.clock.now()
    const invocation: PersistedSkillInvocation = {
      id: request.invocationId,
      taskId: request.taskId,
      requestedSkillId: request.requestedSkillId,
      resolvedProviderId: provider.providerId,
      providerVersion: provider.providerVersion,
      contractVersion: request.contractVersion,
      status: 'queued',
      input: request.input,
      output: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }

    const machine = new SkillInvocationStateMachine()
    await this.persist(invocation, request.checkpointId)
    await this.transition(invocation, machine, request.checkpointId, 'running')

    let finish!: () => void
    const completion = new Promise<void>((resolve) => {
      finish = resolve
    })
    this.active.set(request.invocationId, { provider, completion })

    try {
      const output = await provider.execute(
        { invocationId: request.invocationId, input: request.input },
        signal
      )
      invocation.output = output
      await this.transition(invocation, machine, request.checkpointId, 'completed')
      return output
    } catch (error) {
      const errorDetails = describeError(error)
      invocation.error = errorDetails
      await this.transition(
        invocation,
        machine,
        request.checkpointId,
        errorDetails.name === 'AbortError' ? 'cancelled' : 'failed'
      )
      throw error
    } finally {
      finish()
      this.active.delete(request.invocationId)
    }
  }

  async cancel(invocationId: string): Promise<boolean> {
    const active = this.active.get(invocationId)
    if (!active) return false
    await active.provider.cancel?.(invocationId)
    await active.completion
    return true
  }

  private async transition(
    invocation: PersistedSkillInvocation,
    machine: SkillInvocationStateMachine,
    checkpointId: string,
    status: SkillInvocationState
  ): Promise<void> {
    invocation.status = machine.transition(status)
    invocation.updatedAt = this.clock.now()
    await this.persist(invocation, checkpointId)
  }

  private async persist(invocation: PersistedSkillInvocation, checkpointId: string): Promise<void> {
    const status = invocation.status
    await this.repositories.commitSkillInvocationWithEvent(invocation, {
      taskId: invocation.taskId,
      threadId: invocation.taskId,
      checkpointId,
      eventKey: `skill.${invocation.id}.${status}`,
      type: `skill.${status}`,
      payload: {
        invocationId: invocation.id,
        requestedSkillId: invocation.requestedSkillId,
        resolvedProviderId: invocation.resolvedProviderId,
        providerVersion: invocation.providerVersion,
        status
      },
      occurredAt: invocation.updatedAt
    })
  }
}

function describeError(error: unknown): { name: string; message: string } {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { name?: unknown; message?: unknown }
    return {
      name: typeof candidate.name === 'string' ? candidate.name : 'Error',
      message: typeof candidate.message === 'string' ? candidate.message : String(error)
    }
  }
  return { name: 'Error', message: String(error) }
}
