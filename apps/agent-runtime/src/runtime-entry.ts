import type { ParentPortLike } from './runtime-parent-port'
import { startAgentRuntimeProcess } from './runtime-process'

const dataRoot = process.env.ACTIONDRIVER_RUNTIME_DATA_ROOT
const parentPort = (process as typeof process & { parentPort?: ParentPortLike }).parentPort

if (!parentPort) throw new Error('Agent Runtime requires an Electron parentPort')
if (!dataRoot) throw new Error('Agent Runtime requires ACTIONDRIVER_RUNTIME_DATA_ROOT')

void startAgentRuntimeProcess(parentPort, dataRoot).catch((error: unknown) => {
  parentPort.postMessage({
    type: 'runtime.failed',
    message: error instanceof Error ? error.message : String(error)
  })
  process.exit(1)
})
