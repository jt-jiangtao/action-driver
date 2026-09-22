import {
  createInteractionLogRecorder,
  createLocalInteractionLogStore,
  createLogger,
  DEFAULT_INTERACTION_SOURCE_RETENTION,
  startBestEffortInteraction,
  type ActionDriverLogger,
  type InteractionLogRecorder,
  type InteractionLogStore,
  type InteractionPayloadInput,
  type InteractionRecorderResult
} from '@actiondriver/observability'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export type MainLogging = {
  logger: ActionDriverLogger
  interactions: InteractionLogRecorder
  interactionStore: InteractionLogStore
}

/**
 * Main process logging: every renderer to service interaction is recorded with the same field
 * contract the service uses, so both sides can be aligned by request id.
 */
export async function createMainLogging(options: { userDataPath: string }): Promise<MainLogging> {
  const logger = createLogger({
    name: 'actiondriver-main',
    filePath: join(options.userDataPath, 'logs', 'renderer-service.log')
  })
  const store = await createLocalInteractionLogStore({
    rootDirectory: join(options.userDataPath, 'logs', 'interactions'),
    source: 'main',
    retention: DEFAULT_INTERACTION_SOURCE_RETENTION
  })
  return {
    logger,
    interactionStore: store,
    interactions: createInteractionLogRecorder({
      store,
      ids: {
        eventId: () => `main:${randomUUID()}`,
        correlationId: randomUUID
      },
      logger: logger.logger
    })
  }
}

export function isLogControlPlaneChannel(channel: string): boolean {
  return /^actiondriver:logs?:/.test(channel)
}

export function startIpcInteraction(
  interactions: InteractionLogRecorder | undefined,
  channel: string,
  input: unknown,
  secretPaths: string[] = []
): Promise<((result: InteractionRecorderResult) => Promise<void>) | null> {
  if (!interactions || isLogControlPlaneChannel(channel)) return Promise.resolve(null)
  const request: InteractionPayloadInput = {
    kind: 'json',
    value: input ?? null,
    ...(secretPaths.length ? { secretPaths } : {})
  }
  return startBestEffortInteraction(interactions, {
    transport: 'ipc',
    direction: 'renderer->service',
    operation: channel,
    request
  })
}
