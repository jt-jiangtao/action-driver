import {
  BrowserUseSecurityError,
  emitSecurityAudit,
  securityFailure
} from './service-security-approval.js'
import type { SecurityOptions } from './service-security-approval.js'
import { httpOrigin } from './service-approval-gates.js'
export interface SecurityCommand {
  type: string
  params: unknown
}
const property = (value: unknown, key: string) =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
const unscoped = new Set([
  'browser_user_claim_tab',
  'browser_user_open_tabs',
  'close_tab',
  'create_tab',
  'get_tab',
  'list_tabs',
  'mark_tab',
  'name_session',
  'playwright_wait_for_timeout',
  'selected_tab'
])
export function commandTabId(params: unknown) {
  const number = Number(property(params, 'tab_id'))
  return Number.isInteger(number) && number > 0 ? number : null
}
export function commandSecurityScope(
  command: SecurityCommand
):
  | { kind: 'none' }
  | { kind: 'targetUrl'; url: unknown }
  | { kind: 'currentTab' | 'userTab'; tabId: number } {
  if (unscoped.has(command.type)) return { kind: 'none' }
  if (command.type === 'navigate_tab_url')
    return { kind: 'targetUrl', url: property(command.params, 'url') }
  const id = commandTabId(command.params)
  return id === null
    ? { kind: 'none' }
    : {
        kind: command.type === 'browser_user_get_tab_context' ? 'userTab' : 'currentTab',
        tabId: id
      }
}
export function webMcpPermissionRequest(command: SecurityCommand, options: SecurityOptions) {
  if (command.type === 'webmcp_list_tools') return { type: command.type }
  if (command.type !== 'webmcp_invoke_tool') return null
  const toolName = property(command.params, 'tool_name')
  if (typeof toolName !== 'string' || toolName.trim() === '')
    securityFailure(
      { check: 'webmcp-tool-call', options, reason: 'browser_context_unavailable' },
      `${options.elicitationDisplayName ?? 'Browser use'} could not determine the WebMCP tool name before requesting approval.`
    )
  const string = (key: string) => {
    const value = property(command.params, key)
    return typeof value === 'string' ? value : undefined
  }
  return {
    input: property(command.params, 'input') ?? null,
    toolDescription: string('tool_description'),
    toolName,
    toolOrigin: string('tool_origin'),
    toolTitle: string('tool_title'),
    type: command.type
  }
}
function displayDate(value: unknown) {
  if (typeof value !== 'string') return null
  const date = Date.parse(value)
  return Number.isNaN(date)
    ? value
    : new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      }).format(new Date(date))
}
export function historyRequestDisplay(params: unknown): Record<string, unknown> {
  if (params === null || typeof params !== 'object') return { max_results: 100 }
  const queries = property(params, 'queries'),
    result: Record<string, unknown> = {}
  if (Array.isArray(queries)) {
    const strings: string[] = []
    let valid = true
    for (const value of queries) {
      if (typeof value !== 'string') {
        valid = false
        break
      }
      strings.push(value)
    }
    if (valid) result.queries = strings
  }
  const from = displayDate(property(params, 'from')),
    to = displayDate(property(params, 'to'))
  result.date_range =
    from !== null && to !== null
      ? `${from} to ${to}`
      : from !== null
        ? `Since ${from}`
        : to !== null
          ? `Before ${to}`
          : 'All history'
  const limit = property(params, 'limit')
  result.max_results = typeof limit === 'number' ? limit : 100
  return result
}
export function ensureNavigationUrlPolicy(
  input: unknown,
  options: SecurityOptions,
  authorization?: string
) {
  if (typeof input !== 'string') return
  let reason: 'invalid_url' | 'unsupported_protocol' | undefined
  if (input !== 'about:blank')
    try {
      const url = new URL(input)
      if (!['http:', 'https:'].includes(url.protocol)) reason = 'unsupported_protocol'
    } catch {
      reason = 'invalid_url'
    }
  emitSecurityAudit(() => ({
    backend: options.browserBackend,
    browserFamily: options.browserFamily,
    check: 'check-navigation-url-policy',
    origin: httpOrigin(input) ?? undefined,
    permissionSource: 'navigation-url-policy',
    outcome: reason === undefined ? 'success' : 'denied',
    ...(reason === undefined ? {} : { authorization, reason: 'navigation_url_policy_blocked' })
  }))
  if (reason !== undefined)
    throw new BrowserUseSecurityError(
      'navigation_url_policy_blocked',
      `${options.elicitationDisplayName ?? 'Browser use'} cannot visit the requested page. ${reason === 'invalid_url' ? 'The requested URL is invalid.' : 'The requested URL protocol is not allowed. Allowed protocols: "http:", "https:".'}`
    )
}
