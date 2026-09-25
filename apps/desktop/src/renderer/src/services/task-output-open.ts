import type { TaskOutputFileProjection } from '@actiondriver/contracts'

/**
 * Opening a deliverable goes through the desktop bridge, which re-verifies the
 * registered identifier before handing a temporary copy to the system.
 */
export async function openTaskOutput(file: TaskOutputFileProjection): Promise<void> {
  const bridge = globalThis.window?.actionDriverDesktop?.taskOutput
  if (!bridge) throw new Error('打开文件暂不可用')
  await bridge.open({ fileId: file.fileId, taskId: file.taskId, sessionId: file.sessionId })
}
