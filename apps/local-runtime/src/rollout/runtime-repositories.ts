import type {
  PersistedMessage,
  PersistedStreamRequest,
  PersistedToolInvocation,
  RuntimeEventRecord,
  RuntimeRepositories,
  RuntimeTaskRecord,
  StreamSnapshotRead
} from '@action-driver/agent-runtime/ports'
import type { SqliteRuntimeRepositories } from '../repositories'
import type { RolloutSessionStore } from './session-store'

/**
 * The runtime's persistence entry point. Session history comes from the rollout
 * log; input files and other auxiliary state keep the state database until the
 * remaining stores are relocated in a later step of this change.
 */
export class RolloutRuntimeRepositories implements RuntimeRepositories {
  readonly tasks
  readonly messages
  readonly events
  readonly streamRequests
  readonly toolInvocations
  readonly inputFiles

  constructor(
    private readonly rollout: RolloutSessionStore,
    private readonly state: SqliteRuntimeRepositories
  ) {
    this.tasks = rollout.tasks
    this.messages = rollout.messages
    this.events = rollout.events
    this.streamRequests = rollout.streamRequests
    this.toolInvocations = rollout.toolInvocations
    this.inputFiles = state.inputFiles
  }

  createStreamTask(input: {
    request: PersistedStreamRequest
    task: RuntimeTaskRecord
    userMessage: PersistedMessage
    assistantMessage: PersistedMessage
    acceptedEvent: Omit<RuntimeEventRecord, 'cursor'>
  }): Promise<{ created: boolean; request: PersistedStreamRequest }> {
    return this.rollout.createStreamTask(input)
  }

  commitAssistantContentWithEvent(
    request: PersistedStreamRequest,
    message: PersistedMessage,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord> {
    return this.rollout.commitAssistantContentWithEvent(request, message, event)
  }

  commitAssistantImageWithEvent(
    request: PersistedStreamRequest,
    message: PersistedMessage,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord> {
    return this.rollout.commitAssistantImageWithEvent(request, message, event)
  }

  finishStreamTask(input: {
    request: PersistedStreamRequest
    task: RuntimeTaskRecord
    assistantMessage: PersistedMessage
    event: Omit<RuntimeEventRecord, 'cursor'>
  }): Promise<RuntimeEventRecord> {
    return this.rollout.finishStreamTask(input)
  }

  readStreamSnapshot(requestId: string): Promise<StreamSnapshotRead> {
    return this.rollout.readStreamSnapshot(requestId)
  }

  /** Tool state lives in the rollout, so persisting a call is just appending its event. */
  commitToolInvocationWithEvent(
    _invocation: PersistedToolInvocation,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord> {
    return this.rollout.commitEvent(event)
  }

  recoverInterruptedRequests(code: string): Promise<RuntimeEventRecord[]> {
    return this.rollout.recoverInterruptedRequests(code)
  }

  close(): void {
    this.rollout.close()
    this.state.close()
  }
}
