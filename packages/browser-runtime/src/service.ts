import { createBrowserService } from './service-lifecycle.js'
import { initializeBrowserHost } from './service-host-initialization.js'
import { beginNativeRuntimeTelemetry, createNativeRuntimeFromInitialized } from './service-native-runtime.js'

/** Reconstruction-only service entry. ActionDriver production uses the injected desktop host. */
let activeHost: Awaited<ReturnType<typeof initializeBrowserHost>> | undefined
let activeRuntime: Awaited<ReturnType<typeof createNativeRuntimeFromInitialized>> | undefined
let assemblyQueue = Promise.resolve()
export const handleRpc = createBrowserService({
  prepareHost: () => initializeBrowserHost(),
  createRuntime: async (setup, host) => {
    const previous = assemblyQueue
    let release!: () => void
    assemblyQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      try {
        beginNativeRuntimeTelemetry(host)
      } catch (error) {
        await host.dispose()
        throw error
      }
      try {
        try {
          await activeRuntime?.dispose()
        } finally {
          await activeHost?.dispose()
        }
      } catch (error) {
        await host.dispose()
        throw error
      }
      activeRuntime = undefined
      activeHost = undefined
      try {
        const runtime = await createNativeRuntimeFromInitialized(host, setup)
        activeHost = host
        activeRuntime = runtime
        return runtime
      } catch (error) {
        await host.dispose()
        throw error
      }
    } finally {
      release()
    }
  }
})
