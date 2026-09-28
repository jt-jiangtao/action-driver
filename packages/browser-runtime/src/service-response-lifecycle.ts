import {
  collectBrowserResponseMetadata,
  setBrowserResponseMetadata
} from './service-response-metadata.js'

export interface CommandOutcome {
  backend: string
  commandSucceeded: boolean
  context: any
  currentUrl?: string | undefined
  params: Record<string, any>
  result: unknown
  runtime: any
  webMcpTool?: {
    title?: string
    description?: string
    origin?: string
    annotations?: { readOnlyHint?: boolean }
  } | undefined
  commandType?: string
}
interface Contribution {
  outcome: CommandOutcome
  surfaceDetails: Record<string, unknown>
  cloudBrowserHandoff?: {
    tab_id: string
    browser_conversation_id: string
    connection_thread_id: string
  } | undefined
  siteGuidance?: Array<{ url: string; instruction: string }> | undefined
}
export interface ResponseCollector {
  recordCommand(type: string, outcome: CommandOutcome): void
  takeResponseMetaContribution(): Contribution | undefined | Promise<Contribution | undefined>
}
const publicOrigin = (value: string | undefined) => {
  try {
    const url = new URL(value ?? '')
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.origin : undefined
  } catch { return undefined }
}
const hostname = (value: string | undefined) => {
  try {
    const url = new URL(value ?? '')
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.hostname : undefined
  } catch { return undefined }
}
function metadataSessionId(runtime: any) {
  let value = runtime?.requestMeta?.['x-codex-turn-metadata']
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return undefined }
  }
  return value != null && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.session_id === 'string'
    ? value.session_id : undefined
}

/** Site guidance and handoff contribution, matching the original cN state lifecycle. */
export function createSiteResponseCollector(canObserve: (context: any) => boolean = () => true): ResponseCollector {
  let latest: CommandOutcome | undefined
  let handoff: { outcome: CommandOutcome; target?: {
    tab_id: string
    browser_conversation_id: string
    connection_thread_id: string
  } } | undefined
  const origins = new Set<string>()
  const perTab = new Map<string, CommandOutcome>()
  return {
    recordCommand(type, input) {
      if (!input.commandSucceeded) return
      const outcome = { ...input, commandType: type }
      if (type === 'tab_manual_handoff_request') {
        handoff = { outcome }
        if (
          input.backend === 'cdp' && input.context.environment === 'orbit' &&
          typeof input.params.tab_id === 'string'
        ) {
          const session = input.context.getCurrentSessionId()
          handoff.target = {
            tab_id: input.params.tab_id,
            browser_conversation_id: session,
            connection_thread_id: metadataSessionId(input.runtime) ?? session
          }
        }
      }
      if (input.currentUrl == null) return
      const origin = publicOrigin(input.currentUrl)
      if (origin == null) return
      origins.add(origin)
      latest = outcome
      perTab.set(`${input.context.browserId}:${input.params.tab_id}`, outcome)
    },
    takeResponseMetaContribution() {
      const guidance: Array<{ url: string; instruction: string }> = []
      for (const outcome of perTab.values()) {
        if (outcome.backend !== 'cdp' || outcome.currentUrl == null || !canObserve(outcome.context))
          continue
        const instruction = outcome.context.siteInstructions.take(
          Number(outcome.params.tab_id), outcome.currentUrl
        )
        if (instruction) guidance.push({ url: outcome.currentUrl, instruction })
      }
      const outcome = handoff?.outcome ?? latest
      const selectedHandoff = handoff
      const crossedOrigins = origins.size > 1
      perTab.clear()
      latest = undefined
      handoff = undefined
      origins.clear()
      if (outcome == null || !canObserve(outcome.context)) return undefined
      const handoffTab = selectedHandoff?.outcome.params.tab_id
      const surfaceDetails: Record<string, unknown> = {
        browserId: outcome.context.browserId,
        browserFamily: outcome.context.clientInfo.family
      }
      if (typeof handoffTab === 'string') surfaceDetails.manualHandoffTabId = handoffTab
      return {
        outcome: crossedOrigins ? { ...outcome, currentUrl: undefined, params: {} } : outcome,
        surfaceDetails,
        cloudBrowserHandoff: selectedHandoff?.target,
        siteGuidance: guidance
      }
    }
  }
}

const mutationCommands = new Set([
  'close_tab', 'cua_click', 'cua_double_click', 'cua_drag', 'cua_keypress',
  'cua_move', 'cua_scroll', 'cua_type', 'dom_cua_click', 'dom_cua_double_click',
  'dom_cua_download_media', 'dom_cua_keypress', 'dom_cua_scroll', 'dom_cua_type',
  'navigate_tab_back', 'navigate_tab_forward', 'navigate_tab_reload', 'navigate_tab_url',
  'playwright_locator_click', 'playwright_locator_dblclick', 'playwright_locator_download_media',
  'playwright_locator_fill', 'playwright_locator_press', 'playwright_locator_press_sequentially',
  'playwright_locator_select_option', 'playwright_locator_set_checked', 'tab_ax_action',
  'tab_handle_js_dialog'
])
const observationCommands = new Set([
  'dom_cua_get_visible_dom', 'playwright_dom_snapshot', 'playwright_evaluate',
  'playwright_locator_all_text_contents', 'playwright_locator_count',
  'playwright_locator_get_attribute', 'playwright_locator_inner_text',
  'playwright_locator_is_enabled', 'playwright_locator_is_visible',
  'playwright_locator_read_all', 'playwright_locator_text_content',
  'tab_ax_get_state', 'tab_page_assets_list', 'tab_screenshot', 'webmcp_list_tools'
])
export function createScreenshotResponseCollector(): ResponseCollector {
  let selected: CommandOutcome | undefined
  return {
    recordCommand(type, input) {
      if (input.context.environment === 'orbit' || !input.commandSucceeded) return
      const outcome = { ...input, commandType: type }
      if (mutationCommands.has(type) || (selected == null && input.backend === 'cdp' && observationCommands.has(type)))
        selected = outcome
    },
    async takeResponseMetaContribution() {
      const outcome = selected
      selected = undefined
      if (outcome == null) return undefined
      return {
        outcome,
        surfaceDetails: await collectBrowserResponseMetadata({
          backend: outcome.backend,
          commandSucceeded: outcome.commandSucceeded,
          commandType: outcome.commandType!,
          context: outcome.context,
          params: outcome.params,
          result: outcome.result,
          runtime: outcome.runtime
        })
      }
    }
  }
}

function jsonWithinBudget(value: unknown, budget: number) {
  let json: string | undefined
  try { json = JSON.stringify(value) } catch { return {} }
  if (json == null) return {}
  if (json.length <= budget) return { json }
  return budget === 0
    ? { truncated: true }
    : { json: `${json.slice(0, budget - 1)}\u2026`, truncated: true }
}
const toolName = (type: string, params: Record<string, any>) =>
  type === 'webmcp_list_tools'
    ? type
    : type === 'webmcp_invoke_tool' && typeof params.tool_name === 'string' && params.tool_name.length
      ? params.tool_name : undefined
function webMcpCalls(outcomes: CommandOutcome[]) {
  let budget = 100000
  const calls: Array<Record<string, unknown>> = []
  for (let index = outcomes.length - 1; index >= 0; index--) {
    const outcome = outcomes[index]!
    const name = toolName(outcome.commandType!, outcome.params)
    if (name == null) continue
    const input = outcome.commandType === 'webmcp_invoke_tool'
      ? jsonWithinBudget(outcome.params.input, budget) : {}
    budget -= (input as { json?: string }).json?.length ?? 0
    const output = jsonWithinBudget(outcome.result, budget)
    budget -= (output as { json?: string }).json?.length ?? 0
    calls.push({
      kind: outcome.commandType === 'webmcp_list_tools' ? 'listTools' : 'invokeTool',
      name,
      title: outcome.webMcpTool?.title,
      description: outcome.webMcpTool?.description,
      readOnlyHint: outcome.webMcpTool?.annotations?.readOnlyHint,
      sourceHostname: hostname(
        outcome.commandType === 'webmcp_list_tools'
          ? outcome.currentUrl : outcome.webMcpTool?.origin
      ),
      inputJson: (input as { json?: string }).json,
      inputTruncated: (input as { truncated?: boolean }).truncated,
      outputJson: (output as { json?: string }).json,
      outputTruncated: (output as { truncated?: boolean }).truncated
    })
  }
  return calls.reverse()
}
export function createWebMcpResponseCollector(): ResponseCollector {
  let outcomes: CommandOutcome[] = []
  return {
    recordCommand(type, input) {
      if (!input.commandSucceeded || toolName(type, input.params) == null) return
      outcomes.push({ ...input, commandType: type })
    },
    takeResponseMetaContribution() {
      const consumed = outcomes
      outcomes = []
      const latest = consumed.at(-1)
      const calls = webMcpCalls(consumed)
      if (latest == null || calls.length === 0) return undefined
      return {
        outcome: latest,
        surfaceDetails: {
          browserId: latest.context.browserId,
          browserFamily: latest.context.clientInfo.family,
          webMcpCalls: calls
        }
      }
    }
  }
}

interface ResponseHost {
  addAfterSubmittedCodeHook(hook: { timeoutMs: number; run(): Promise<void> }): (() => void) | void
  credentialRegistry?: {
    isUnsafe(): boolean
    gates(): Array<{ usedNativeCredentials: boolean }>
    checkBroker(): Promise<unknown>
  }
}
export function responseObservationAllowed(host: ResponseHost, context?: any) {
  const registry = host.credentialRegistry
  return registry?.isUnsafe() !== true &&
    context?.credentialObservationGate?.usedNativeCredentials !== true &&
    (registry?.gates().every((gate) => !gate.usedNativeCredentials) ?? true)
}
async function responseBrokerAllowed(host: ResponseHost, context?: any) {
  if (!responseObservationAllowed(host, context)) return false
  try {
    await host.credentialRegistry?.checkBroker()
    return responseObservationAllowed(host, context)
  } catch { return false }
}

/** Registers the original 10-second metadata hook and merges contributions after submitted code. */
export function createResponseLifecycle(
  initialCollectors: Iterable<ResponseCollector>,
  host: ResponseHost
) {
  const collectors = [...initialCollectors]
  const remove = host.addAfterSubmittedCodeHook({
    timeoutMs: 10000,
    async run() {
      if (!responseObservationAllowed(host)) return
      const contributions: Contribution[] = []
      for (const collector of collectors) {
        if (!responseObservationAllowed(host)) return
        const contribution = await collector.takeResponseMetaContribution()
        if (contribution != null && responseObservationAllowed(host, contribution.outcome.context))
          contributions.push(contribution)
      }
      const handoff = contributions.find((item) => item.surfaceDetails.manualHandoffTabId != null)
      const chosen = handoff ??
        contributions.find((item) => item.surfaceDetails.screenshot != null) ??
        contributions[0]
      if (chosen == null) return
      let selectedOutcome = handoff?.outcome
      let surface: Record<string, unknown> = {}
      for (const item of contributions) {
        if (
          item.outcome.backend !== chosen.outcome.backend ||
          item.outcome.context.browserId !== chosen.outcome.context.browserId
        ) continue
        selectedOutcome ??= item.outcome
        surface = { ...surface, ...item.surfaceDetails }
      }
      if (selectedOutcome == null || !(await responseBrokerAllowed(host, selectedOutcome.context))) return
      const guidance = contributions.flatMap((item) => item.siteGuidance ?? [])
      if (guidance.length > 0)
        selectedOutcome.runtime.setResponseMeta({ 'codex/browserSiteGuidance': guidance })
      setBrowserResponseMetadata(selectedOutcome.runtime, selectedOutcome.backend, {
        ...surface,
        cloudBrowserHandoff: handoff?.cloudBrowserHandoff,
        currentUrl: selectedOutcome.currentUrl,
        params: selectedOutcome.params
      })
      const target = handoff?.cloudBrowserHandoff
      if (target != null) {
        const url = new URL('https://chatgpt.com/browser/handoff')
        url.searchParams.set('thread_id', target.browser_conversation_id)
        url.searchParams.set('tab_id', target.tab_id)
        if (target.connection_thread_id !== target.browser_conversation_id)
          url.searchParams.set('connection_thread_id', target.connection_thread_id)
        selectedOutcome.runtime.emitContentItem(
          JSON.stringify({ browserHandoff: { url: url.href, cloud_browser_handoff: target } })
        )
      }
    }
  })
  return {
    register(collector: ResponseCollector) { collectors.push(collector) },
    recordCommand(type: string, outcome: CommandOutcome) {
      if (!responseObservationAllowed(host, outcome.context)) return
      for (const collector of collectors) collector.recordCommand(type, outcome)
    },
    dispose() { if (typeof remove === 'function') remove() }
  }
}
