import { createLocalRuntime, type LocalRuntimeOptions } from './runtime-process'
import type { RuntimeHost } from './runtime-host'

export async function startHostedLocalRuntime(
  host: RuntimeHost | null,
  options: LocalRuntimeOptions,
  exit: (code: number) => void = process.exit
) {
  if (!host) throw new Error('RUNTIME_HOST_UNAVAILABLE: lifecycle host is required')
  const runtime = await createLocalRuntime(options)
  host.onShutdown(() => {
    void runtime.close().then(
      () => exit(0),
      () => exit(1)
    )
  })
  host.ready(runtime.ready)
  return runtime
}
