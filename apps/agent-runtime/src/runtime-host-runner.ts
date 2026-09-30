import { createAgentRuntime, type AgentRuntimeOptions } from './runtime-process'
import type { RuntimeHost } from './runtime-host'

export async function startHostedAgentRuntime(
  host: RuntimeHost | null,
  options: AgentRuntimeOptions,
  exit: (code: number) => void = process.exit
) {
  if (!host) throw new Error('RUNTIME_HOST_UNAVAILABLE: lifecycle host is required')
  const runtime = await createAgentRuntime(options)
  host.onShutdown(() => {
    void runtime.close().then(
      () => exit(0),
      () => exit(1)
    )
  })
  host.ready(runtime.ready)
  return runtime
}
