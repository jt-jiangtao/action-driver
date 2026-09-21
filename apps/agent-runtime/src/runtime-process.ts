import { createLocalRuntimeServer } from './local-runtime-server'
import { waitForRuntimeMessagePort, type ParentPortLike } from './parent-port-endpoint'

type ParentMessageEvent = { data: unknown }

export async function startAgentRuntimeProcess(
  parentPort: ParentPortLike,
  databasePath: string,
  exit: (code: number) => void = process.exit
): Promise<void> {
  const endpoint = await waitForRuntimeMessagePort(parentPort)
  const server = createLocalRuntimeServer(endpoint, databasePath)
  const handleShutdown = (event: ParentMessageEvent) => {
    if (
      typeof event.data !== 'object' ||
      event.data === null ||
      !('type' in event.data) ||
      event.data.type !== 'runtime.shutdown'
    ) {
      return
    }
    parentPort.off('message', handleShutdown)
    void server.close().then(() => exit(0))
  }
  parentPort.on('message', handleShutdown)
  parentPort.postMessage({ type: 'runtime.ready' })
}
