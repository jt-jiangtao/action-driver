import type { Hono } from 'hono'
import { success } from './http-contract'

export const SERVICE_PROTOCOL_VERSION = 1

export type ServiceMetadataRoutes = {
  runtimeVersion: string
}

export function registerServiceMetadataRoutes(
  app: Hono,
  options: ServiceMetadataRoutes
): void {
  app.get('/readyz', (context) => context.text('ok'))
  app.get('/healthz', (context) => context.text('ok'))
  app.get('/version', (context) =>
    context.json(
      success({
        runtimeVersion: options.runtimeVersion,
        protocolVersion: SERVICE_PROTOCOL_VERSION
      })
    )
  )
}
