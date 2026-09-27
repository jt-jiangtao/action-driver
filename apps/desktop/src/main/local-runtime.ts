import { mkdirSync } from 'node:fs'
import type { RuntimePaths } from './runtime-paths'
import { RuntimeSupervisor, createElectronRuntimeProcessFactory } from './runtime-supervisor'
import type { SkillProviderHost } from './skill-provider-host'
import { connectLocalCapabilityHost } from './local-capability-client'

export function createLocalRuntimeServices(
  paths: RuntimePaths,
  skillProviderHost: SkillProviderHost,
  options: {
    serviceToken: string
    credentialKey: string
    agentHomeDirectory?: string
    trustedRendererOrigin?: string
    capabilityDisconnected?(): void
    authorizeSkillExecution?: (skillId: string) => Promise<void>
  }
): { runtimeSupervisor: RuntimeSupervisor } {
  const configuredWorkspaceRoot = process.env.ACTIONDRIVER_WORKSPACE_ROOT?.trim()
  if (!configuredWorkspaceRoot) mkdirSync(paths.workspaceRoot, { recursive: true })
  const workspaceRoot = configuredWorkspaceRoot || paths.workspaceRoot
  let capabilityHost: { close(): void } | null = null
  let connectionGeneration = 0
  const processFactory = createElectronRuntimeProcessFactory({
    databasePath: paths.databasePath,
    workspaceRoot,
    ...(options.agentHomeDirectory ? { agentHomeDirectory: options.agentHomeDirectory } : {}),
    serviceToken: options.serviceToken,
    credentialKey: options.credentialKey,
    ...(options.trustedRendererOrigin
      ? { trustedRendererOrigin: options.trustedRendererOrigin } : {})
  })
  return {
    runtimeSupervisor: new RuntimeSupervisor(processFactory, paths.runtimeEntryPath, {
      onServiceReady: async (service) => {
        const generation = ++connectionGeneration
        const nextHost = await connectLocalCapabilityHost({
          baseUrl: service.baseUrl,
          token: options.serviceToken,
          host: skillProviderHost,
          ...(options.capabilityDisconnected ? { disconnected: options.capabilityDisconnected } : {}),
          ...(options.authorizeSkillExecution
            ? { authorize: options.authorizeSkillExecution } : {})
        })
        if (generation !== connectionGeneration) {
          nextHost.close()
          return
        }
        capabilityHost?.close()
        capabilityHost = nextHost
      }
    })
  }
}
