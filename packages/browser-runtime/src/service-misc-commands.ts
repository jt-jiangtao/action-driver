import { captureTabScreenshot } from './service-screenshot.js'
import { navigateTabUrl } from './service-navigate-url.js'
import { requestManualAuthHandoff } from './service-auth-handoff.js'
import { TabBotDetectionCommands } from './commands/structured.js'
import { turnMetadata } from './service-discovery.js'
import { browserTelemetry } from './service-telemetry.js'

type BotContext = {
  clientInfo: { type: string; family?: string }
  runtime: {
    platform: string
    env: Record<string, string | undefined>
    requestMeta?: Record<string, unknown>
    fetch(url: any, options: any): Promise<any>
  }
  cdp: {
    readDocumentState(id: number): Promise<{ href?: string } | null | undefined>
    currentTopLevelUrl(id: number): string | undefined
  }
}
type Telemetry = Pick<typeof browserTelemetry, 'logEvent'>
const backendNames: Record<string, string> = { cdp: 'cdp', extension: 'chrome', iab: 'iab' }
const unknown = 'unknown'

function reportedHostname(url: string | undefined) {
  if (!url) return null
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

/** Event payload is kept separate from transport logging for deterministic parity checks. */
export function botDetectionEvent(input: {
  backend: string | undefined
  reason: string
  turnMetadata?: Record<string, unknown> | undefined
  url?: string | undefined
}) {
  const turn = input.turnMetadata,
    session = turn?.session_id ?? unknown,
    thread = turn?.thread_id ?? session,
    hostname = reportedHostname(input.url)
  return {
    name: 'browser_use_bot_detection_reported',
    value: input.reason,
    metadata: {
      backend: input.backend,
      conversation_id:
        typeof turn?.chatgpt_conversation_id === 'string' &&
        turn.chatgpt_conversation_id.trim().length > 0
          ? turn.chatgpt_conversation_id
          : session,
      model: turn?.model ?? unknown,
      session_id: session,
      thread_id: thread,
      thread_source: turn?.thread_source ?? (session !== unknown && thread === session ? 'user' : unknown),
      turn_id: turn?.turn_id ?? unknown,
      hostname: hostname ?? unknown,
      reason: input.reason
    },
    reportedHostname: hostname
  }
}

export async function reportBotDetection(
  input: unknown,
  context: BotContext,
  telemetry: Telemetry = browserTelemetry
) {
  const params = TabBotDetectionCommands.Report.PayloadSchema.parse(input),
    id = Number(params.tab_id)
  if (!Number.isSafeInteger(id) || id <= 0) throw Error('Expected a positive integer')
  const state = await context.cdp.readDocumentState(id),
    url = state?.href ?? context.cdp.currentTopLevelUrl(id),
    event = botDetectionEvent({
      backend: backendNames[context.clientInfo.type],
      reason: params.reason,
      turnMetadata: turnMetadata(context.runtime),
      url
    })
  telemetry.logEvent(
    context.runtime,
    event.name,
    event.value,
    event.metadata,
    context.clientInfo
  )
  return { status: 'reported' as const, hostname: event.reportedHostname }
}

function filteredHandoffContext(context: Parameters<typeof requestManualAuthHandoff>[1]) {
  const disabled = new Set(
    (context.runtime.env.BROWSER_USE_DISABLE_TAB_CAPABILITIES ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  )
  return {
    ...context,
    clientInfo: {
      ...context.clientInfo,
      capabilities: {
        ...context.clientInfo.capabilities,
        tab: context.clientInfo.capabilities?.tab?.filter(({ id }) => !disabled.has(id)) ?? []
      }
    }
  }
}

/** Registry-level command entry points; security and response metadata wrap these upstream. */
export const miscCommandHandlers = {
  tab_screenshot: (
    params: Parameters<typeof captureTabScreenshot>[0],
    context: Parameters<typeof captureTabScreenshot>[1]
  ) => captureTabScreenshot(params, context, 'css'),
  navigate_tab_url: (
    params: Parameters<typeof navigateTabUrl>[0],
    context: Parameters<typeof navigateTabUrl>[1],
    approval: Promise<unknown>
  ) => navigateTabUrl(params, context, approval),
  tab_manual_handoff_request: (
    params: Parameters<typeof requestManualAuthHandoff>[0],
    context: Parameters<typeof requestManualAuthHandoff>[1]
  ) => {
    const selected = filteredHandoffContext(context)
    if (
      selected.clientInfo.type !== 'cdp' ||
      !selected.clientInfo.capabilities.tab.some(({ id }) => id === 'browserAuth')
    )
      throw Error(`${context.clientInfo.name} does not support command "tab_manual_handoff_request".`)
    return requestManualAuthHandoff(params, selected)
  },
  tab_bot_detection_report: reportBotDetection
}
