import {
  createInteractionLogger,
  createLogger,
  type ActionDriverLogger,
  type InteractionLogger
} from '@actiondriver/observability'
import { join } from 'node:path'

export type MainLogging = {
  logger: ActionDriverLogger
  interactions: InteractionLogger
}

/**
 * Main process logging: every renderer to service interaction is recorded with the same field
 * contract the service uses, so both sides can be aligned by request id.
 */
export function createMainLogging(options: { userDataPath: string }): MainLogging {
  const logger = createLogger({
    name: 'actiondriver-main',
    filePath: join(options.userDataPath, 'logs', 'renderer-service.log')
  })
  return { logger, interactions: createInteractionLogger(logger.logger) }
}
