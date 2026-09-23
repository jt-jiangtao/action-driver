import { RuntimeClient } from '@actiondriver/runtime-contracts'
import type { RuntimePaths } from './runtime-paths'
import { RuntimeClientGateway } from './runtime-client-gateway'
import { RuntimeSupervisor, createElectronRuntimeProcessFactory } from './runtime-supervisor'
import type { SkillProviderHost } from './skill-provider-host'

const RUNTIME_CAPABILITIES = [
  'task.submit',
  'task.get',
  'task.list',
  'model-log.list',
  'model-log.get',
  'task.interrupt',
  'task.continue',
  'task.provide-input',
  'skill.control',
  'event.subscribe'
] as const

export function createLocalRuntimeServices(
  paths: RuntimePaths,
  appVersion: string,
  skillProviderHost: SkillProviderHost,
  options: {
    serviceToken: string
    credentialKey: string
    authorizeSkillExecution?: (skillId: string) => Promise<void>
  } = {
    serviceToken: '',
    credentialKey: ''
  }
): {
  runtimeClient: RuntimeClientGateway
  runtimeSupervisor: RuntimeSupervisor
} {
  const runtimeClient = new RuntimeClientGateway()
  let connectRuntimeRpc: (() => Promise<void>) | null = null
  const processFactory = createElectronRuntimeProcessFactory({
    databasePath: paths.databasePath,
    ...(options.serviceToken ? { serviceToken: options.serviceToken } : {}),
    ...(options.credentialKey ? { credentialKey: options.credentialKey } : {}),
    onEndpoint(endpoint) {
      const client = new RuntimeClient(endpoint, {
        appVersion,
        capabilities: RUNTIME_CAPABILITIES,
        onSkillExecute: (request) =>
          skillProviderHost.execute(request, Date.now() + 30_000, options.authorizeSkillExecution)
      })
      let beginConnection: (() => void) | null = null
      const connectedClient = new Promise<RuntimeClient>((resolve, reject) => {
        beginConnection = () => {
          void client.connect().then(() => resolve(client), reject)
        }
      })
      runtimeClient.attach(connectedClient)
      connectRuntimeRpc = async () => {
        if (!beginConnection) throw new Error('Runtime RPC connection was already started')
        const begin = beginConnection
        beginConnection = null
        begin()
        await connectedClient
      }
    }
  })

  return {
    runtimeClient,
    runtimeSupervisor: new RuntimeSupervisor(processFactory, paths.runtimeEntryPath, {
      onRuntimeRpcReady: async () => {
        if (!connectRuntimeRpc) throw new Error('Runtime RPC endpoint is unavailable')
        const connect = connectRuntimeRpc
        connectRuntimeRpc = null
        await connect()
      }
    })
  }
}
