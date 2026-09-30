import { dirname, join, resolve } from 'node:path'
import { SessionSandbox } from './execution/session-sandbox'
import { createScriptTools } from './execution/tools'
import { resolveExecutionRuntimePaths } from './execution/runtime-paths'

export async function createRuntimeExecutionEnvironment(options: {
  runtimeEntry: string
  workspaceRoot: string
  environment: NodeJS.ProcessEnv
}) {
  const { runtimeEntry, workspaceRoot, environment } = options
  const runtimeDist = resolve(dirname(runtimeEntry), runtimeEntry.endsWith('.ts') ? '../dist' : '.')
  const agentHome = environment.ACTION_DRIVER_AGENT_HOME?.trim() || workspaceRoot
  const timeoutOverride = Number(environment.ACTION_DRIVER_SCRIPT_TIMEOUT_MS)
  const sandbox = new SessionSandbox({
    runtimeRoots: [runtimeDist, join(agentHome, '.action-driver', 'skills')]
  })
  const scriptTools = await createScriptTools({
    runtimeDist,
    sandbox,
    ...(Number.isSafeInteger(timeoutOverride) &&
    timeoutOverride >= 1_000 &&
    timeoutOverride <= 600_000
      ? { timeoutMs: timeoutOverride }
      : {})
  })
  const runtimePaths = await resolveExecutionRuntimePaths(runtimeDist, process.arch, ['node'])
  return { runtimeDist, agentHome, scriptTools, runtimePaths }
}
