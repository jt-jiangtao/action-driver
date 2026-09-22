import { createLocalRuntimeServer } from './local-runtime-server'
import { waitForRuntimeMessagePort, type ParentPortLike } from './parent-port-endpoint'
import { openRuntimeDatabase } from './database'
import { createSqliteModelConnectionStore } from './model-connections/sqlite-store'
import { createCredentialCipher, createCredentialKey } from './model-connections/credential-cipher'
import { createServiceLogger } from './service/logger'
import { startServiceHttpServer, type ServiceHttpServer } from './service/http-service'
import { ModelConnectionService, createFetchHttpTransport } from '@actiondriver/model-connections'
import {
  createInteractionLogRecorder,
  createLocalInteractionLogStore
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
  const server = createLocalRuntimeServer(endpoint, databasePath)

  const serviceToken = environment.ACTIONDRIVER_SERVICE_TOKEN?.trim()
  let httpServer: ServiceHttpServer | null = null
  let logging: ReturnType<typeof createServiceLogger> | null = null

  if (serviceToken) {
    const database = openRuntimeDatabase(databasePath)
    logging = createServiceLogger({ databasePath })
    const interactionStore = await createLocalInteractionLogStore({
      rootDirectory: join(dirname(databasePath), '..', 'logs', 'interactions'),
      source: 'service'
    })
    const interactions = createInteractionLogRecorder({
      store: interactionStore,
      ids: {
        eventId: () => `service:${randomUUID()}`,
        correlationId: randomUUID
      },
      logger: logging.logger
    })
    const service = new ModelConnectionService({
      store: createSqliteModelConnectionStore(database),
      cipher: createCredentialCipher(
        createCredentialKey(environment.ACTIONDRIVER_CREDENTIAL_KEY ?? '')
      ),
      transport: createFetchHttpTransport()
    })
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
      await logging?.close()
      exit(0)
    })
  }

  parentPort.on('message', handleShutdown)
  parentPort.postMessage({
    type: 'runtime.ready',
    service: httpServer ? { baseUrl: httpServer.url } : null
  })
}
