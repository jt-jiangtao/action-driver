import type { ParentPortLike } from './parent-port-endpoint'
import { startAgentRuntimeProcess } from './runtime-process'

const databasePath = process.env.ACTIONDRIVER_RUNTIME_DATABASE_PATH
const parentPort = (process as typeof process & { parentPort?: ParentPortLike }).parentPort

if (!parentPort) throw new Error('Agent Runtime requires an Electron parentPort')
if (!databasePath) throw new Error('Agent Runtime requires ACTIONDRIVER_RUNTIME_DATABASE_PATH')

void startAgentRuntimeProcess(parentPort, databasePath).catch((error: unknown) => {
  parentPort.postMessage({
    type: 'runtime.failed',
    message: error instanceof Error ? error.message : String(error)
  })
  process.exit(1)
})
