import type { MiddlewareHandler } from 'hono'
import {
  startBestEffortInteraction,
  type InteractionLogRecorder,
  type StructuredLogger
} from '@action-driver/observability'
import { failure } from './http-contract'
import {
  bearerToken,
  credentialValues,
  isRecord,
  readLimitedBody,
  redactSecrets,
  tokenMatches
} from './http-utils'

export type RequestPolicy = {
  tokenDigest: Buffer
  bodyLimitBytes: number
  logger: StructuredLogger | null
  interactions?: InteractionLogRecorder
  rendererOrigin?: string
}

/**
 * Source check, credential check, bounded body read and best-effort interaction logging.
 * The rejection order (origin → credential → body) and the trusted-origin preflight
 * short-circuit are part of the service contract.
 */
export function createRequestPolicyMiddleware(policy: RequestPolicy): MiddlewareHandler {
  const { tokenDigest: expected, bodyLimitBytes, logger, interactions, rendererOrigin } = policy
  return async (context, next) => {
    const startedAt = Date.now()
    const method = context.req.method
    const path = context.req.path
    const binaryUpload =
      method === 'POST' && (path === '/assets/staged' || path === '/input-files/staged')
    const binaryDownload = method === 'GET' && /^\/sessions\/[^/]+\/assets\/[^/]+$/.test(path)
    const requestLog = logger?.child({ transport: 'http', method, path })
    const origin = context.req.header('origin')
    const originRejected = origin !== undefined && origin !== rendererOrigin
    if (method === 'OPTIONS' && origin === rendererOrigin && origin !== undefined) {
      const requestedMethod = context.req.header('access-control-request-method')?.toUpperCase()
      const requestedHeaders =
        context.req
          .header('access-control-request-headers')
          ?.split(',')
          .map((header) => header.trim().toLowerCase()) ?? []
      if (
        !requestedMethod ||
        !['GET', 'POST', 'PUT', 'DELETE'].includes(requestedMethod) ||
        requestedHeaders.some(
          (header) => !['authorization', 'content-type', 'x-action-driver-file-name'].includes(header)
        )
      ) {
        return context.json(failure('unauthorized', 'Preflight request is not allowed'), 403)
      }
      return context.body(null, 204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Action-Driver-File-Name',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin'
      })
    }
    const authRejected =
      path !== '/readyz' &&
      path !== '/healthz' &&
      !tokenMatches(bearerToken(context.req.header('authorization')), expected)
    let requestBody: unknown = null
    let bodyError: string | null = null
    if (
      !originRejected &&
      !authRejected &&
      !binaryUpload &&
      (method === 'POST' || method === 'PUT' || method === 'PATCH')
    ) {
      const raw = await readLimitedBody(context.req.raw.clone(), bodyLimitBytes)
      if (raw === null) bodyError = 'Request body is too large'
      else if (raw.trim()) {
        try {
          requestBody = JSON.parse(raw) as unknown
        } catch {
          bodyError = 'Request body must be valid JSON'
        }
      }
    }
    const secretValues = credentialValues(requestBody, ['apiKey', 'draft.apiKey'])
    const finish = interactions
      ? await startBestEffortInteraction(
          interactions,
          {
            transport: 'http',
            direction: 'renderer->service',
            operation: method + ' ' + path,
            startedAt,
            request: {
              kind: 'json',
              value: {
                method,
                path,
                query: Object.fromEntries(new URL(context.req.url).searchParams),
                headers: Object.fromEntries(context.req.raw.headers),
                body: binaryUpload
                  ? {
                      kind: 'binary-image',
                      mimeType: context.req.header('content-type') ?? null,
                      byteLength: context.req.header('content-length') ?? null
                    }
                  : requestBody
              },
              secretPaths: [
                'headers.authorization',
                'headers.proxy-authorization',
                'headers.cookie',
                'headers.set-cookie',
                'headers.x-api-key',
                'body.apiKey',
                'body.draft.apiKey'
              ]
            }
          },
          (error) =>
            requestLog?.warn(
              { error: error instanceof Error ? error.message : String(error) },
              'interaction log write failed'
            )
        )
      : null

    if (originRejected) {
      requestLog?.warn({ status: 403, reason: 'origin-rejected' }, 'service request rejected')
      context.res = context.json(failure('unauthorized', 'Browser origins are not allowed'), 403)
    } else if (authRejected) {
      requestLog?.warn({ status: 401, reason: 'unauthorized' }, 'service request rejected')
      context.res = context.json(
        failure('unauthorized', 'A valid service credential is required'),
        401
      )
    } else if (bodyError) {
      context.res = context.json(failure('invalid-request', bodyError), 400)
    } else {
      requestLog?.info({ status: 'accepted' }, 'service request received')
      await next()
    }

    if (origin !== undefined && !originRejected) {
      context.header('Access-Control-Allow-Origin', origin)
      context.header('Vary', 'Origin')
    }

    const responseText = binaryDownload && context.res.ok ? '' : await context.res.clone().text()
    let responseValue: unknown
    if (binaryDownload && context.res.ok) {
      responseValue = {
        kind: 'binary-image',
        mimeType: context.res.headers.get('content-type'),
        byteLength: context.res.headers.get('content-length')
      }
    } else
      try {
        responseValue = JSON.parse(responseText) as unknown
      } catch {
        responseValue = responseText
      }
    const envelope = isRecord(responseValue) ? responseValue : null
    const failed = envelope?.ok === false
    const outcome: 'error' | 'ok' = context.res.status >= 400 || failed ? 'error' : 'ok'
    const error = failed && isRecord(envelope.error) ? envelope.error : null
    const interactionError =
      error && typeof error.code === 'string' && typeof error.message === 'string'
        ? { code: error.code, message: error.message }
        : null
    await finish?.({
      outcome,
      status: context.res.status,
      response:
        typeof responseValue === 'string'
          ? {
              kind: 'text',
              text: responseValue,
              contentType: context.res.headers.get('content-type') ?? 'text/plain'
            }
          : { kind: 'json', value: responseValue },
      secretValues,
      ...(interactionError ? { error: interactionError } : {})
    })
    const loggedMessage =
      error && typeof error.message === 'string'
        ? redactSecrets(error.message, secretValues)
        : undefined
    if (outcome === 'error') {
      requestLog?.error(
        {
          status: context.res.status,
          ...(error && typeof error.code === 'string' ? { code: error.code } : {}),
          ...(loggedMessage ? { message: loggedMessage } : {}),
          durationMs: Date.now() - startedAt
        },
        'service request failed'
      )
    } else {
      requestLog?.info(
        { status: context.res.status, durationMs: Date.now() - startedAt },
        'service response'
      )
    }
  }
}
