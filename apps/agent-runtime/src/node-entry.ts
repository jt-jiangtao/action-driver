import { createNodeRuntimeHost } from './node-host'
import { startHostedAgentRuntime } from './runtime-host-runner'

const dataRoot = process.env.ACTIONDRIVER_RUNTIME_DATA_ROOT?.trim()
const workspaceRoot = process.env.ACTIONDRIVER_WORKSPACE_ROOT?.trim()

if (!dataRoot)
  throw new Error('RUNTIME_DATA_ROOT_INVALID: ACTIONDRIVER_RUNTIME_DATA_ROOT is required')
if (!workspaceRoot) throw new Error('SANDBOX_ROOT_INVALID: workspace root is required')

void startHostedAgentRuntime(createNodeRuntimeHost(), { dataRoot, workspaceRoot }).catch(
  (error: unknown) => {
    console.error('[runtime] failed to start', error)
    process.exit(1)
  }
)
