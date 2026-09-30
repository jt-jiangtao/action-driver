import { createNodeRuntimeHost } from './node-host'
import { startHostedLocalRuntime } from './runtime-host-runner'

const dataRoot = process.env.ACTION_DRIVER_RUNTIME_DATA_ROOT?.trim()
const workspaceRoot = process.env.ACTION_DRIVER_WORKSPACE_ROOT?.trim()

if (!dataRoot)
  throw new Error('RUNTIME_DATA_ROOT_INVALID: ACTION_DRIVER_RUNTIME_DATA_ROOT is required')
if (!workspaceRoot) throw new Error('SANDBOX_ROOT_INVALID: workspace root is required')

void startHostedLocalRuntime(createNodeRuntimeHost(), { dataRoot, workspaceRoot }).catch(
  (error: unknown) => {
    console.error('[runtime] failed to start', error)
    process.exit(1)
  }
)
