export interface CredentialGate {
  browserId: string
  usedNativeCredentials: boolean
  observationEpoch: number
  assertRetainedObservationAllowed(): void
  assertObservationAllowed(
    tabId: number,
    epoch: number | undefined,
    selected: boolean
  ): Promise<void>
  invalidateDocuments(tabId: number): void
}
export interface CredentialCommandHost {
  assertHealthy(): void
  gates(): CredentialGate[]
  checkBroker(): Promise<unknown>
  beginCommand(): () => void
  isUnsafe(): boolean
}
export interface CredentialCommand {
  type: string
  [key: string]: unknown
}
const navigations = new Set([
  'navigate_tab_url',
  'navigate_tab_back',
  'navigate_tab_forward',
  'navigate_tab_reload',
  'close_tab'
])
const documentation = new Set(['get_documentation', 'get_browser_documentation'])
const observations = new Set([
  'get_tab',
  'tab_screenshot',
  'tab_handle_js_dialog',
  'cua_click',
  'cua_double_click',
  'cua_drag',
  'cua_keypress',
  'cua_move',
  'cua_scroll',
  'cua_type',
  'dom_cua_click',
  'dom_cua_double_click',
  'dom_cua_get_visible_dom',
  'dom_cua_keypress',
  'dom_cua_scroll',
  'dom_cua_type',
  'tab_ax_action',
  'tab_ax_get_state',
  'playwright_dom_snapshot',
  'playwright_evaluate',
  'playwright_locator_all_text_contents',
  'playwright_locator_click',
  'playwright_locator_count',
  'playwright_locator_dblclick',
  'playwright_locator_fill',
  'playwright_locator_get_attribute',
  'playwright_locator_inner_text',
  'playwright_locator_is_enabled',
  'playwright_locator_is_visible',
  'playwright_locator_press',
  'playwright_locator_press_sequentially',
  'playwright_locator_read_all',
  'playwright_locator_select_option',
  'playwright_locator_set_checked',
  'playwright_locator_text_content',
  'playwright_locator_wait_for',
  'playwright_wait_for_load_state',
  'playwright_wait_for_timeout',
  'playwright_wait_for_url'
])
let handoffTail: Promise<unknown> = Promise.resolve()
export const canObserveCredentials = (host: CredentialCommandHost) =>
  !host.isUnsafe() && host.gates().every((gate) => !gate.usedNativeCredentials)
/** Command orchestration; concrete document credential gates are supplied by service assembly. */
export function createCredentialCommandGuard(
  run: (command: CredentialCommand, finish?: () => void) => Promise<unknown>,
  host: CredentialCommandHost,
  resolveBrowser: (id: unknown) => Promise<unknown> = async (id) => id
) {
  return async (command: CredentialCommand) => {
    host.assertHealthy()
    const handoff = command.type === 'tab_browser_auth_handoff',
      navigation = navigations.has(command.type),
      create = command.type === 'create_tab',
      docs = documentation.has(command.type)
    let releaseHandoff: (() => void) | undefined
    if (handoff) {
      const previous = handoffTail
      handoffTail = new Promise<void>((resolve) => {
        releaseHandoff = resolve
      })
      await previous
    }
    let finish: (() => void) | undefined,
      resolving = false,
      effective = command
    const epochs = new Map(host.gates().map((gate) => [gate, gate.observationEpoch]))
    const observe = async (after: boolean) => {
      if (docs || navigation || create || (handoff && after)) return
      const gates = host.gates(),
        protectedGate = gates.find((gate) => gate.usedNativeCredentials),
        browserId = 'browser_id' in effective ? effective.browser_id : undefined,
        tabId = 'tab_id' in effective ? Number(effective.tab_id) : NaN,
        selected = gates.find((gate) => gate.browserId === browserId)
      if (
        protectedGate !== undefined &&
        ((!handoff && !observations.has(command.type)) ||
          selected === undefined ||
          !Number.isSafeInteger(tabId) ||
          tabId <= 0)
      )
        protectedGate.assertRetainedObservationAllowed()
      for (const gate of gates)
        await gate.assertObservationAllowed(
          tabId,
          after ? (epochs.get(gate) ?? 0) : undefined,
          protectedGate !== undefined && gate === selected
        )
    }
    try {
      finish = host.beginCommand()
      if ('browser_id' in command && host.gates().some((gate) => gate.usedNativeCredentials)) {
        resolving = true
        effective = { ...command, browser_id: await resolveBrowser(command.browser_id) }
        resolving = false
      }
      if (navigation && 'browser_id' in effective && 'tab_id' in effective)
        host
          .gates()
          .find((gate) => gate.browserId === effective.browser_id)
          ?.invalidateDocuments(Number(effective.tab_id))
      await observe(false)
      await host.checkBroker()
      const result = await run(effective, handoff ? finish : undefined)
      await observe(true)
      await host.checkBroker()
      if (create) {
        if (
          result === null ||
          typeof result !== 'object' ||
          !('id' in result) ||
          typeof result.id !== 'string' ||
          !/^[1-9]\d*$/.test(result.id) ||
          !Number.isSafeInteger(Number(result.id))
        )
          throw Error('Browser returned an invalid new tab identifier')
        return { id: result.id }
      }
      return navigation && !canObserveCredentials(host) ? {} : result
    } catch (error) {
      if (navigation || create || handoff || resolving)
        for (const gate of host.gates()) gate.assertRetainedObservationAllowed()
      await observe(true)
      await host.checkBroker()
      throw error
    } finally {
      finish?.()
      releaseHandoff?.()
    }
  }
}
