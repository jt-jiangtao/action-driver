// @vitest-environment node
import { expect, test } from 'vitest'
import { originalDocumentation } from './original-service'

test('candidate registry exposes only concrete original browser commands and rejects duplicate registration', async () => {
  const candidate = await import('../src/service-command-registry').catch(() => ({} as any)) as any
  expect(typeof candidate.createCommandRegistry).toBe('function')
  const baseline = await originalDocumentation()
  const originalNames = new Set(
    Object.values(baseline.baselineBrowserHandlerModules as Record<string, { type?: string }>)
      .map((handler) => handler.type)
      .filter((type): type is string => typeof type === 'string')
  )
  const handlers = candidate.createCommandRegistry()
  expect(originalNames.size).toBe(75)
  expect(new Set(Object.keys(handlers))).toEqual(originalNames)
  for (const handler of Object.values(handlers)) expect(typeof handler).toBe('function')
  for (const name of ['playwright_evaluate', 'playwright_wait_for_file_chooser',
    'playwright_file_chooser_set_files', 'tab_ax_action', 'dom_cua_get_visible_dom',
    'webmcp_list_tools', 'webmcp_invoke_tool', 'browser_user_claim_tab',
    'tab_page_assets_list', 'tab_cdp_call', 'tab_cdp_events',
    'navigate_tab_url', 'tab_screenshot', 'tab_manual_handoff_request',
    'tab_bot_detection_report', 'tab_content_export_gsuite',
    'tab_content_export_youtube_transcript'])
    expect(typeof handlers[name]).toBe('function')
  expect(() => candidate.createCommandRegistry({ playwright_evaluate: async () => ({}) }))
    .toThrow('Duplicate browser command: playwright_evaluate')
})
