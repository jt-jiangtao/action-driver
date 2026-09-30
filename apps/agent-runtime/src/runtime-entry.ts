import type { ParentPortLike } from './electron-host'
import { startAgentRuntimeProcess } from './electron-host'

const dataRoot = process.env.ACTIONDRIVER_RUNTIME_DATA_ROOT
const parentPort = (process as typeof process & { parentPort?: ParentPortLike }).parentPort

if (!parentPort) throw new Error('RUNTIME_HOST_UNAVAILABLE: Electron parentPort is required')
if (!dataRoot) throw new Error('Agent Runtime requires ACTIONDRIVER_RUNTIME_DATA_ROOT')

void startAgentRuntimeProcess(parentPort, dataRoot).catch((error: unknown) => {
  parentPort.postMessage({
    type: 'runtime.failed',
    message: error instanceof Error ? error.message : String(error)
  })
  process.exit(1)
})
