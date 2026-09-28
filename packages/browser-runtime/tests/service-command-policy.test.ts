// @vitest-environment node
import { test, expect } from 'vitest'
import {
  commandSecurityScope,
  commandTabId,
  webMcpPermissionRequest,
  historyRequestDisplay,
  ensureNavigationUrlPolicy
} from '../src/service-command-policy'
import { Commands } from '../src/commands'
import { originalDocumentation } from './original-service'
test('all command scope classifications and tab id conversion match baseline', async () => {
  const base = await originalDocumentation()
  for (const definition of Object.values(Commands))
    if ('commandType' in definition)
      for (const id of [undefined, null, '1', '0', '-1', '1.5', true, 1e100, 'bad']) {
        const command = {
          type: definition.commandType,
          params: { tab_id: id, url: 'https://example.com' }
        }
        expect(commandTabId(command.params)).toBe(base.baselineCommandTabId(command.params))
        expect(commandSecurityScope(command)).toEqual(base.baselineSecurityScope(command))
      }
})
test('WebMCP security projection preserves null/default inputs and rejects missing tool names', async () => {
  const base = await originalDocumentation()
  for (const type of ['other', 'webmcp_list_tools', 'webmcp_invoke_tool'])
    for (const params of [
      {},
      {
        tool_name: 'name',
        input: { value: 1 },
        tool_description: 'description',
        tool_origin: 'https://example.com',
        tool_title: 'title'
      },
      { tool_name: '   ' },
      { tool_name: 'name', input: undefined, tool_title: 1 }
    ]) {
      function result(run: any) {
        try {
          return { value: run({ type, params }, {}) }
        } catch (e: any) {
          return { error: e.message, reason: e.reason }
        }
      }
      expect(result(webMcpPermissionRequest)).toEqual(result(base.baselineWebMcpPermissionRequest))
    }
})
test('history display preserves query validation, date formatting and fallback result limits', async () => {
  const base = await originalDocumentation()
  for (const params of [
    undefined,
    null,
    {},
    [],
    { queries: ['one', 'two'], from: '2026-01-01', to: '2026-02-01', limit: 10 },
    { queries: ['one', 1], from: 'unknown' },
    { to: 'unknown', limit: 'bad' },
    { queries: [], limit: -1 }
  ])
    expect(historyRequestDisplay(params)).toEqual(base.baselineHistoryDisplay(params))
})
test('navigation URL policy permits only HTTP(S) and exact about:blank with original audit/reason', async () => {
  const base = await originalDocumentation(),
    { setSecurityAudit } = await import('../src/service-security-approval')
  for (const url of [
    'https://example.com',
    'http://example.com',
    'about:blank',
    'about:blank#hash',
    'file:///tmp/a',
    'data:text/plain,x',
    'javascript:alert(1)',
    'chrome://settings',
    'invalid',
    null
  ]) {
    function result(run: any, set: any) {
      const events: any[] = []
      set((event: any) => events.push(event))
      let error
      try {
        run(url, { browserBackend: 'iab' }, 'full-cdp')
      } catch (e: any) {
        error = { message: e.message, reason: e.reason, retryable: e.retryable }
      }
      set(undefined)
      return { events, error }
    }
    expect(result(ensureNavigationUrlPolicy, setSecurityAudit)).toEqual(
      result(base.baselineNavigationPolicy, base.baselineSetAudit)
    )
  }
})
