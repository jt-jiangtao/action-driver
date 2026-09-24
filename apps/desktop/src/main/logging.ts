import {
  createInteractionLogRecorder,
  createProcessObservability,
  startBestEffortInteraction,
  type ProcessObservability,
  type InteractionLogRecorder,
  type InteractionCompletion,
  type InteractionPayloadInput
} from '@actiondriver/observability'
import { randomUUID } from 'node:crypto'

export type MainLogging = {
  logger: ProcessObservability
  interactions: InteractionLogRecorder
}

/**
 * Main process logging: every renderer to service interaction is recorded with the same field
 * contract the service uses, so both sides can be aligned by request id.
 */
export async function createMainLogging(): Promise<MainLogging> {
  const logger = createProcessObservability({ serviceName: 'actiondriver-main' })
  return {
    logger,
    interactions: createInteractionLogRecorder({
      ids: {
        eventId: () => `main:${randomUUID()}`,
        correlationId: randomUUID
      },
      logger: logger.logger,
      tracer: logger.tracer,
      meter: logger.meter
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
): Promise<InteractionCompletion | null> {
  if (!interactions || isLogControlPlaneChannel(channel)) return Promise.resolve(null)
  const request: InteractionPayloadInput = {
    kind: 'json',
    value: input ?? null,
    ...(secretPaths.length ? { secretPaths } : {})
  }
  const identifiers = interactionIdentifiers(input)
  return startBestEffortInteraction(interactions, {
    transport: 'ipc',
    direction: 'renderer->service',
    operation: channel,
    ...identifiers,
    request
  })
}

function interactionIdentifiers(input: unknown): { taskId?: string; requestId?: string } {
  if (!input || typeof input !== 'object') return {}
  const value = input as { taskId?: unknown; requestId?: unknown }
  return {
    ...(typeof value.taskId === 'string' ? { taskId: value.taskId } : {}),
    ...(typeof value.requestId === 'string' ? { requestId: value.requestId } : {})
  }
}
