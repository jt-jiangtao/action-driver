import type { TaskOutputFileProjection } from '@action-driver/contracts'

/**
 * Opening a deliverable goes through the desktop bridge, which re-verifies the
 * registered identifier before handing a temporary copy to the system.
 */
export async function openTaskOutput(file: TaskOutputFileProjection): Promise<void> {
  const bridge = globalThis.window?.productDesktop?.taskOutput
  if (!bridge) throw new Error('打开文件暂不可用')
  // Prefer the unified resource reference; the legacy triple keeps older projections working.
  await bridge.open(
    file.uri
      ? { uri: file.uri, taskId: file.taskId, sessionId: file.sessionId }
      : { fileId: file.fileId, taskId: file.taskId, sessionId: file.sessionId }
  )
}
