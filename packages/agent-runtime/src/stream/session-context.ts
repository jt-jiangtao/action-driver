import type { ToolPresentation } from '@action-driver/plugin-contracts'
import type { AppApprovalPort, AssetPort, InputFilePort, OutputPort } from '../host-ports'
import type {
  GraphRunner,
  IdGenerator,
  PersistedStreamRequest,
  RuntimeEventRecord,
  StreamSessionRepository
} from '../ports'
import type { Emit } from './event-delivery'

export type StreamSessionOptions = {
  repositories: StreamSessionRepository
  graphRunner: GraphRunner
  ids: IdGenerator
  now(): string
  rawToolIO?: { enabled: boolean; maxBytes?: number }
  toolPresentation?: (toolId: string) => ToolPresentation | undefined
  appApprovals?: AppApprovalPort
  /**
   * Host cleanup for a finished turn (Computer Use: cancel pending app approvals, release app
   * leases). Runs once per turn, whatever its outcome, before its response.end is published.
   */
  turnEnded?: (taskId: string) => Promise<void>
  listEnabledSkills?: () => Promise<Array<{ skillId: string; description: string }>>
  assets?: AssetPort
  inputFiles?: InputFilePort
  outputs?: OutputPort
  listOutputs?: (taskId: string) => Promise<
    Array<{
      fileId: string
      sessionId: string
      taskId: string
      name: string
      mimeType: string
      byteLength: number
    }>
  >
  describeSessionInputs?: (
    sessionId: string
  ) => Promise<Array<{ name: string; path: string; mimeType: string }>>
}

export type StreamEventFactory = (
  request: PersistedStreamRequest,
  type: string,
  sequence: number | null,
  payload: unknown,
  eventKey?: string
) => Omit<RuntimeEventRecord, 'cursor'>

export type StreamPublish = (
  request: PersistedStreamRequest,
  cursor: number,
  emit: Emit
) => Promise<void>
