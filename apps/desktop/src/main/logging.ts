import {
  createInteractionLogRecorder,
  createLocalInteractionLogStore,
  createLogger,
  type ActionDriverLogger,
  type InteractionLogRecorder,
  type InteractionPayloadInput
} from '@actiondriver/observability'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export type MainLogging = {
  logger: ActionDriverLogger
  interactions: InteractionLogRecorder
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
    source: 'main'
  })
  return {
    logger,
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
): ReturnType<InteractionLogRecorder['start']> | Promise<null> {
  if (!interactions || isLogControlPlaneChannel(channel)) return Promise.resolve(null)
  const request: InteractionPayloadInput = {
    kind: 'json',
    value: input ?? null,
    ...(secretPaths.length ? { secretPaths } : {})
  }
  return interactions.start({
    transport: 'ipc',
    direction: 'renderer->service',
    operation: channel,
    request
  })
}
