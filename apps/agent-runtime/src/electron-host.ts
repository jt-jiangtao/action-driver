import type { RuntimeHost } from './runtime-host'
import { startHostedAgentRuntime } from './runtime-host-runner'

type ParentMessageEvent = { data: unknown }

export interface ParentPortLike {
  postMessage(message: unknown): void
  on(event: 'message', listener: (event: ParentMessageEvent) => void): unknown
  off(event: 'message', listener: (event: ParentMessageEvent) => void): unknown
}

export function createElectronRuntimeHost(parentPort: ParentPortLike): RuntimeHost {
  return {
    ready(descriptor) {
      parentPort.postMessage({ type: 'runtime.ready', ...descriptor })
    },
    onShutdown(handler) {
      const listener = (event: ParentMessageEvent) => {
        if (
          typeof event.data !== 'object' ||
          event.data === null ||
          !('type' in event.data) ||
          event.data.type !== 'runtime.shutdown'
        )
          return
        parentPort.off('message', listener)
        handler()
      }
      parentPort.on('message', listener)
    }
  }
}

export async function startAgentRuntimeProcess(
  parentPort: ParentPortLike,
  dataRoot: string,
  exit: (code: number) => void = process.exit,
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const workspaceRoot = environment.ACTION_DRIVER_WORKSPACE_ROOT?.trim()
  if (!workspaceRoot) throw new Error('SANDBOX_ROOT_INVALID: workspace root is required')
  await startHostedAgentRuntime(
    createElectronRuntimeHost(parentPort),
    { dataRoot, workspaceRoot, environment },
    exit
  )
}
