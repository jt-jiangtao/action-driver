import { RuntimeClient } from '@actiondriver/runtime-contracts'
import type { RuntimePaths } from './runtime-paths'
import { RuntimeClientGateway } from './runtime-client-gateway'
import { RuntimeSupervisor, createElectronRuntimeProcessFactory } from './runtime-supervisor'
import type { SkillProviderHost } from './skill-provider-host'

const RUNTIME_CAPABILITIES = [
  'task.submit',
  'task.get',
  'task.interrupt',
  'task.continue',
  'task.provide-input',
  'skill.control',
  'event.subscribe'
] as const

export function createLocalRuntimeServices(
  paths: RuntimePaths,
  appVersion: string,
  skillProviderHost: SkillProviderHost
): { runtimeClient: RuntimeClientGateway; runtimeSupervisor: RuntimeSupervisor } {
  const runtimeClient = new RuntimeClientGateway()
  const processFactory = createElectronRuntimeProcessFactory({
    databasePath: paths.databasePath,
    onEndpoint(endpoint) {
      const client = new RuntimeClient(endpoint, {
        appVersion,
        capabilities: RUNTIME_CAPABILITIES,
        onSkillExecute: (request) => skillProviderHost.execute(request, Date.now() + 30_000)
      })
      runtimeClient.attach(client.connect().then(() => client))
    }
  })

  return {
    runtimeClient,
    runtimeSupervisor: new RuntimeSupervisor(processFactory, paths.runtimeEntryPath)
  }
}
