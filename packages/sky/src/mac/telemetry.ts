import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { platform } from 'node:os'
import type { TelemetrySink } from './policy.js'
interface TelemetryClient {
  initializeAsync(): Promise<unknown>
  updateUserSync(user: unknown): unknown
  logEvent(event: unknown): unknown
}
export interface TelemetrySdk {
  StatsigMetadataProvider: { add(metadata: Record<string, unknown>): unknown }
  StatsigClient: new (
    key: string,
    user: Record<string, unknown>,
    options: Record<string, unknown>
  ) => TelemetryClient
}
export interface TelemetryHost {
  config?: unknown
  env?: Record<string, string | undefined>
  requestMeta?: Record<string, unknown>
  fetch?: (url: string, options?: unknown) => Promise<{ json(): Promise<unknown> }>
}
interface Options {
  getHost?: () => TelemetryHost | undefined
  getSdk?: () => TelemetrySdk
  eventId?: () => string
}
const require = createRequire(import.meta.url)
const trim = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
const disabled = (host: TelemetryHost) =>
  host.env?.NODE_REPL_DISABLE_ANALYTICS === '1' ||
  host.env?.BROWSER_USE_DISABLE_AMBIENT_NETWORK === '1'
const tier = (host: TelemetryHost) => {
  switch (trim(host.env?.BROWSER_USE_CODEX_APP_BUILD_FLAVOR)) {
    case 'dev':
    case 'agent':
      return 'development'
    case 'internal-alpha':
    case 'nightly':
      return 'staging'
    default:
      return 'production'
  }
}
function metadata(host: TelemetryHost | undefined): Record<string, string | undefined> {
  let value = host?.requestMeta?.['x-codex-turn-metadata']
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return {}
    }
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {}
  const data = value as Record<string, unknown>
  return {
    threadId: trim(data.thread_id) ?? trim(data.threadId) ?? trim(data.session_id),
    turnId: trim(data.turn_id),
    itemId: trim(data.item_id) ?? trim(data.itemId) ?? trim(data.call_id),
    model: trim(data.model),
    reasoningEffort:
      trim(data.reasoning_effort) ?? trim(data.reasoningEffort) ?? trim(data.model_reasoning_effort)
  }
}
export function createComputerUseTelemetry(options: Options = {}): TelemetrySink {
  const getHost =
    options.getHost ??
    (() => (globalThis as typeof globalThis & { nodeRepl?: TelemetryHost }).nodeRepl)
  const getSdk = options.getSdk ?? (() => require('@statsig/js-client') as TelemetrySdk)
  const eventId = options.eventId ?? randomUUID
  let client: TelemetryClient | undefined,
    launched = false
  function runtime(): TelemetryHost | undefined {
    const host = getHost()
    return host?.config != null && typeof host.fetch === 'function' ? host : undefined
  }
  const custom = (host: TelemetryHost) => ({
    codexAppVersion: trim(host.env?.BROWSER_USE_CODEX_APP_VERSION) ?? 'unknown',
    platform: platform()
  })
  async function initialize(created: TelemetryClient): Promise<void> {
    try {
      await created.initializeAsync()
      const host = runtime()
      if (!host || disabled(host)) return
      const response = await host.fetch!('https://chatgpt.com/backend-api/me')
      const user = await response.json()
      if (user !== null && typeof user === 'object') {
        const data = user as Record<string, unknown>
        if (data.object === 'user' && typeof data.id === 'string' && typeof data.email === 'string')
          created.updateUserSync({ email: data.email, userID: data.id, custom: custom(host) })
      }
    } catch {
      return
    }
  }
  function log(
    name: string,
    params: Record<string, unknown>,
    createdAt = new Date().toISOString()
  ): boolean {
    try {
      const host = runtime()
      if (!host || disabled(host)) return false
      if (!client) {
        const sdk = getSdk()
        sdk.StatsigMetadataProvider.add({
          appIdentifier: 'sky',
          appVersion: trim(host.env?.BROWSER_USE_CODEX_APP_VERSION) ?? 'unknown'
        })
        client = new sdk.StatsigClient(
          'client-br04gwIKFntB05BUONtNnF3NhWQsvmSI8R97Pigr7A5',
          { userID: trim(host.env?.NODE_REPL_SENTRY_USER_ID), custom: custom(host) },
          {
            environment: { tier: tier(host) },
            loggingEnabled: 'always',
            networkConfig: {
              api: 'https://ab.chatgpt.com/v1',
              logEventUrl: 'https://chatgpt.com/ces/v1/rgstr',
              networkOverrideFunc: (url: string, init?: unknown) => host.fetch!(url, init),
              sdkExceptionUrl: 'https://ab.chatgpt.com/v1/sdk_exception'
            }
          }
        )
        void initialize(client)
      }
      client.logEvent({
        eventName: '__protobuf_structured_event__',
        metadata: {
          eventCreatedAt: createdAt,
          eventId: eventId(),
          eventParams: {
            '@type': `openai.buf.dev/openai/protobuf-analytics-events/protobuf_analytics_events.v1.${name}`,
            ...params,
            runtime: 'CODEX_COMPUTER_USE_MCP_RUNTIME_NODE_REPL'
          },
          eventType: 'client'
        }
      })
      return true
    } catch {
      return false
    }
  }
  return {
    clientCreated() {
      if (!launched) launched = log('CodexComputerUseMcpServerLaunched', { transport: 'stdio' })
    },
    approvalRequested(event) {
      log(
        'CodexComputerUseMcpAppApprovalRequested',
        { bundleIdentifier: event.bundleIdentifier, toolName: event.toolName },
        event.eventCreatedAt
      )
    },
    approvalResolved(event) {
      log('CodexComputerUseMcpAppApprovalResolved', {
        approvalResult: event.approvalResult,
        bundleIdentifier: event.bundleIdentifier,
        toolName: event.toolName,
        ...(event.approvalPersistence == null
          ? {}
          : { approvalPersistence: event.approvalPersistence })
      })
    },
    toolCalled(event) {
      const turn = metadata(runtime())
      log('CodexComputerUseMcpToolCalled', {
        durationMs: event.durationMs,
        invocationSource: 'code_mode',
        mcpErrorPresent: event.terminalStatus !== 'completed',
        mcpServerName: 'node_repl',
        pluginId: 'computer-use@openai-bundled',
        terminalStatus: event.terminalStatus,
        toolName: event.toolName,
        transport: 'native_pipe',
        ...(event.bundleIdentifier == null ? {} : { bundleIdentifier: event.bundleIdentifier }),
        ...Object.fromEntries(Object.entries(turn).filter(([, value]) => value != null))
      })
    }
  }
}
