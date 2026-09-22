import { createLocalRuntimeServer } from './local-runtime-server'
import { createLocalRuntimeAdapters } from './local-adapters'
import { waitForRuntimeMessagePort, type ParentPortLike } from './parent-port-endpoint'
import { openRuntimeDatabase } from './database'
import { SqliteRuntimeRepositories } from './repositories'
import { createSqliteCheckpointer } from './sqlite-checkpointer'
import { ConnectionModelGateway } from './model-connections/model-gateway'
import { createSqliteModelConnectionStore } from './model-connections/sqlite-store'
import { createCredentialCipher, createCredentialKey } from './model-connections/credential-cipher'
import { createServiceLogger } from './service/logger'
import { startServiceHttpServer, type ServiceHttpServer } from './service/http-service'
import { ModelConnectionService, createFetchHttpTransport } from '@actiondriver/model-connections'
import {
  createInteractionLogRecorder,
  createLocalInteractionLogStore,
  DEFAULT_INTERACTION_SOURCE_RETENTION
} from '@actiondriver/observability'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

type ParentMessageEvent = { data: unknown }

export async function startAgentRuntimeProcess(
  parentPort: ParentPortLike,
  databasePath: string,
  exit: (code: number) => void = process.exit,
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const endpoint = await waitForRuntimeMessagePort(parentPort)
  const serviceToken = environment.ACTIONDRIVER_SERVICE_TOKEN?.trim()
  const database = openRuntimeDatabase(databasePath)
  const repositories = new SqliteRuntimeRepositories(database)
  const checkpointer = createSqliteCheckpointer(databasePath)
  const logging = createServiceLogger({ databasePath })
  const interactionStore = await createLocalInteractionLogStore({
    rootDirectory: join(dirname(databasePath), '..', 'logs', 'interactions'),
    source: 'service',
    retention: DEFAULT_INTERACTION_SOURCE_RETENTION
  })
  const interactions = createInteractionLogRecorder({
    store: interactionStore,
    ids: {
      eventId: () => `service:${randomUUID()}`,
      correlationId: randomUUID
    },
    logger: logging.logger
  })
  const credentialSecret = environment.ACTIONDRIVER_CREDENTIAL_KEY?.trim()
  const service = new ModelConnectionService({
    store: createSqliteModelConnectionStore(database),
    cipher: createCredentialCipher(
      credentialSecret ? createCredentialKey(credentialSecret) : Buffer.alloc(0)
    ),
    transport: createFetchHttpTransport()
  })
  const modelGateway = new ConnectionModelGateway({
    service,
    modelCalls: repositories.modelCalls,
    interactions,
    callId: () => `model-call:${randomUUID()}`,
    correlationId: randomUUID,
    now: () => new Date().toISOString()
  })
  const local = createLocalRuntimeAdapters({ repositories, checkpointer, modelGateway })
  const server = createLocalRuntimeServer(endpoint, {
    adapters: local.adapters,
    messages: repositories.messages,
    modelCalls: repositories.modelCalls
  })

  let httpServer: ServiceHttpServer | null = null

  if (serviceToken) {
    httpServer = await startServiceHttpServer({
      service,
      token: serviceToken,
      runtimeVersion: environment.ACTIONDRIVER_RUNTIME_VERSION ?? '0.1.0',
      logger: logging.logger,
      logFilePath: logging.logFilePath,
      interactions
    })
  }

  const handleShutdown = (event: ParentMessageEvent) => {
    if (
      typeof event.data !== 'object' ||
      event.data === null ||
      !('type' in event.data) ||
      event.data.type !== 'runtime.shutdown'
    ) {
      return
    }
    parentPort.off('message', handleShutdown)
    void server.close().then(async () => {
      await httpServer?.close()
      checkpointer.close()
      repositories.close()
      await logging.close()
      exit(0)
    })
  }

  parentPort.on('message', handleShutdown)
  parentPort.postMessage({
    type: 'runtime.ready',
    service: httpServer ? { baseUrl: httpServer.url } : null
  })
}
