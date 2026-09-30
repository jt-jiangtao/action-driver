import type { AppApprovalDecision, AppApprovalRequest, ImageAssetRef } from '@action-driver/contracts'

export type AppApprovalEvent =
  | { type: 'computer.app-approval.requested'; request: AppApprovalRequest }
  | {
      type: 'computer.app-approval.resolved'
      request: AppApprovalRequest
      decision: AppApprovalDecision | 'cancelled'
    }

export interface AppApprovalPort {
  getPending(taskId: string): readonly AppApprovalRequest[]
  cancelTask(taskId: string): Promise<void>
}

export type BoundInputFile = {
  fileId: string
  name: string
  mimeType: string
  byteLength: number
  sessionId: string
  taskId: string
  relativePath: string
  absolutePath: string
}

export interface InputFilePort {
  bind(fileId: string, binding: { sessionId: string; taskId: string }): Promise<BoundInputFile>
}

export type OutputBaseline = {
  sessionId: string
  capturedAt: string
  entries: Record<string, { size: number; modifiedMs: number }>
}

export type DetectedOutput = {
  relativePath: string
  name: string
  mimeType: string
  bytes: Uint8Array
}

export interface OutputPort {
  baseline(sessionId: string): Promise<OutputBaseline>
  detectChanges(sessionId: string, baseline: OutputBaseline): Promise<DetectedOutput[]>
  register(input: {
    sessionId: string
    taskId: string
    files: ReadonlyArray<DetectedOutput>
  }): Promise<Array<{
    fileId: string
    sessionId: string
    taskId: string
    name: string
    mimeType: string
    byteLength: number
  }>>
}

export interface AssetPort {
  bindStaged(assetId: string, sessionId: string): Promise<ImageAssetRef>
}
