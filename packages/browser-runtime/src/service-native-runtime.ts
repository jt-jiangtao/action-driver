import { BrowserDocumentation } from './service-documentation.js'
import { browserResources, readBrowserGuidance } from './service-resources.js'
import { createBrowserCommandDispatcher } from './service-command-dispatch.js'
import { BrowserBackend } from './service-backend.js'
import {
  createResponseLifecycle,
  createSiteResponseCollector,
  createScreenshotResponseCollector,
  createWebMcpResponseCollector,
  responseObservationAllowed
} from './service-response-lifecycle.js'
import { createBrowserNotifications } from './service-browser-notifications.js'
import { browserTelemetry } from './service-telemetry.js'
import { browserStatsig } from './service-statsig.js'
import { setSecurityAudit } from './service-security-approval.js'
import { securityAuditTelemetry } from './service-audit-telemetry.js'
import type { BrowserServiceSetup } from './service-lifecycle.js'

interface Initialized {
  env: Record<string, string | undefined>
  browserContext: any
  credentialRegistry: any
  commandTiming: any
  performanceSpan: any
  config: any
  filesystem: any
  [key: string]: unknown
}
interface AssemblyOptions {
  createBackend?: ((browser: any) => any) | undefined
  handlers?: Record<string, (...args: any[]) => Promise<unknown>> | undefined
  telemetry?: Pick<typeof browserTelemetry, 'initialize' | 'logEvent'> &
    Partial<Pick<typeof browserTelemetry, 'setReporter'>>
}
const release = '1.0.0'
type RuntimeTelemetry = NonNullable<AssemblyOptions['telemetry']>
const pendingTelemetry = new WeakSet<object>()
const disabledMembers = (host: Initialized) =>
  new Set(
    (host.env.BROWSER_USE_DISABLE_API_MEMBERS ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  )

function installNativeRuntimeTelemetry(host: Initialized, telemetry: RuntimeTelemetry) {
  const reporter = host.errorReporter as {
    captureException(error: unknown): unknown
    setUser(user: unknown): unknown
    setTag(name: string, value: string): unknown
  } | undefined
  if (reporter != null) {
    const capture = reporter.captureException.bind(reporter)
    browserStatsig.setReporter(capture)
    telemetry.setReporter?.(capture)
    setSecurityAudit((event) => {
      const otel = host.otel as { log(name: string, value: unknown): unknown } | undefined
      if (otel != null) {
        const value = securityAuditTelemetry(event)
        if (value != null) otel.log('codex.browser_use.security_check', value)
      }
      const backend = event.backend as string | undefined
      const metadata: Record<string, unknown> = {
        backend: 'unknown', browser_family: 'unknown', check: event.check
      }
      if (backend != null) {
        metadata.backend = ({ cdp: 'cdp', extension: 'chrome', iab: 'iab' } as Record<string, string>)[backend]
        metadata.browser_family = backend === 'extension'
          ? event.browserFamily ?? 'unknown' : 'not_applicable'
      }
      if (event.durationMs != null) metadata.duration_ms = event.durationMs
      if (event.httpStatus != null) metadata.http_status = event.httpStatus
      if (event.permissionSource != null) metadata.permission_source = event.permissionSource
      if (event.reason != null) metadata.reason = event.reason
      telemetry.logEvent(host as any, 'browser_use_security_check', event.outcome, metadata)
    })
    void telemetry.initialize(host as any, reporter)
    telemetry.logEvent(host as any, 'browser_use_invocation_started', 'multi', {
      backend: 'multi', platform: host.platform, release
    })
  }
}

/** Begin the next invocation before disposing the previous service instance. */
export function beginNativeRuntimeTelemetry(
  host: Initialized,
  telemetry: RuntimeTelemetry = browserTelemetry
) {
  installNativeRuntimeTelemetry(host, telemetry)
  pendingTelemetry.add(host)
}

/** Connect packaged documentation and the concrete macOS command path to an initialized host. */
export async function createNativeRuntimeFromInitialized(
  host: Initialized,
  setup: BrowserServiceSetup,
  assembly: AssemblyOptions = {}
) {
  const telemetry = assembly.telemetry ?? browserTelemetry
  if (!pendingTelemetry.delete(host)) installNativeRuntimeTelemetry(host, telemetry)
  const reporter = host.errorReporter as object | undefined
  const resources = await browserResources(setup.environment),
    disabledMemberIds = disabledMembers(host),
    documentManifest =
      setup.environment === 'orbit' || host.env.CUA_REPL_BROWSER_ENV === 'orbit'
        ? resources.documentManifest.map((entry) =>
            entry.name === 'confirmations' ? { ...entry, mode: 'model' as const } : entry
          )
        : resources.documentManifest,
    addendum = host.env.CUA_REPL_ENABLED_SURFACES?.split(',').includes('browser')
      ? host.env.CUA_REPL_BROWSER_DOCUMENTATION_ADDENDUM?.trim() || undefined
      : undefined,
    docs = new BrowserDocumentation({
      apiManifest: resources.apiManifest,
      documentManifest,
      disabledMemberIds,
      ...(setup.undocumentedApiMembers == null ? {} : { undocumentedApiMembers: setup.undocumentedApiMembers }),
      ...(setup.excludedDocumentation == null ? {} : { excludedDocumentation: setup.excludedDocumentation }),
      ...(addendum == null ? {} : { addendum }),
      readDocumentation: async (name) => {
        if (name === 'confirmations') {
          if (setup.environment === 'orbit') return ''
          const policies = (host.requestMeta as Record<string, unknown> | undefined)?.['openai/confirmation_policies']
          const text = policies != null && typeof policies === 'object'
            ? (policies as Record<string, unknown>).browser_use : undefined
          if (typeof text === 'string' && text.trim() && new TextEncoder().encode(text).byteLength <= 12000)
            return text
        }
        return await readBrowserGuidance(host as Parameters<typeof readBrowserGuidance>[0], name,
          undefined, { environment: setup.environment })
      }
    })
  const createBackend = assembly.createBackend ?? ((browser: any) =>
    new BrowserBackend(browser.api, browser.id, browser.info, {
      runtime: host,
      commandTiming: host.commandTiming,
      config: host.config,
      elicitationDisplayName: setup.environment === 'cloud' || setup.environment === 'orbit'
        ? 'Cloud browser' : 'Browser use',
      environment: setup.environment,
      filesystem: host.filesystem,
      performanceSpan: host.performanceSpan,
      preferredWindowId: host.browserContext.preferredWindowIdFor(browser.info)
    }))
  const responseLifecycle = typeof host.addAfterSubmittedCodeHook === 'function'
    ? createResponseLifecycle([
        createSiteResponseCollector((context) => responseObservationAllowed(host as any, context)),
        createScreenshotResponseCollector(),
        createWebMcpResponseCollector()
      ], host as any)
    : undefined
  const notifications = typeof host.addAfterSubmittedCodeHook === 'function'
    ? createBrowserNotifications(host as any)
    : undefined
  const dispatcher = createBrowserCommandDispatcher({
    context: host.browserContext,
    credential: host.credentialRegistry,
    docs,
    host,
    createBackend,
    ...(responseLifecycle == null ? {} : { responseLifecycle }),
    ...(notifications == null ? {} : { notifications }),
    ...(assembly.handlers == null ? {} : { handlers: assembly.handlers }),
    ...(typeof host.performanceSpan?.withCommandTelemetry !== 'function'
      ? {} : { telemetry: host.performanceSpan })
  })
  if (reporter != null) {
    telemetry.logEvent(host as any, 'browser_use_setup', undefined, { backend: 'multi' })
    telemetry.logEvent(host as any, 'browser_use_invocation_ready', 'multi', {
      backend: 'multi', platform: host.platform, release
    })
  }
  return {
    apiManifest: resources.apiManifest,
    disabledMemberIds,
    executeAgentCommand: dispatcher,
    docs,
    async dispose() {
      responseLifecycle?.dispose()
      notifications?.dispose()
      await dispatcher.dispose()
    }
  }
}
