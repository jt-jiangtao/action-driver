type Status = 'submitted' | 'submission_failed' | 'page_changed' | 'origin_changed' | 'locator_invalid'
interface Params {
  tab_id: string
  origin: string
  timeout_ms?: number
  fields: Array<{ id: string; selector: string; type: string }>
  submit?: { selector: string; action: string } | null
  options?: Array<{ id: string; selector?: string | null; field_ids?: string[] | null }> | null
}
interface Context {
  playwright: {
    withBoundPlaywrightSelector<T>(tabId: number, selector: string,
      allowed: () => Promise<boolean>, run: (bound: Context['playwright']) => Promise<T>,
      options: { timeoutMs: number | undefined; isolatedWorld?: boolean }): Promise<T | undefined>
    evaluateOnPlaywrightSelectorWithTarget(tabId: string, selector: string,
      page: (element: Element, injected: any, arg: any) => unknown,
      options: { arg: Record<string, unknown>; timeoutMs: number | undefined; isolatedWorld?: boolean }): Promise<unknown>
    evaluateOnPlaywrightSelector?(tabId: string, selector: string,
      page: (element: Element, injected: unknown, arg: { origin: string }) => boolean,
      options: { arg: { origin: string }; timeoutMs: number | undefined; isolatedWorld: true }): Promise<unknown>
    clickLocator(params: { tab_id: number; selector: string; timeout_ms?: number }, count: number): Promise<unknown>
    pressLocator?(params: { tab_id: number; selector: string; value: string; timeout_ms?: number }): Promise<unknown>
    evaluateOnPlaywrightSelectorAll?(tabId: string, selector: string,
      page: (elements: Element[]) => number, options: { timeoutMs: number | undefined }): Promise<number>
    readElementState?(params: { tab_id: string; selector: string; timeout_ms?: number },
      state: string): Promise<boolean>
  }
  revalidate(): Promise<Status | null>
  nativeDelivery?: boolean
  credentialPlan?: { fillFields: Array<{ promptId: string; fields: Params['fields'] }> }
  pressLocator?(params: { tab_id: number; selector: string; value: string; timeout_ms?: number }, bound: Context['playwright']): Promise<unknown>
}

function nativeSubmitPage(element: Element, _injected: unknown, arg: { origin: string }): boolean {
  const control = element as HTMLButtonElement | HTMLInputElement
  const form = control.form
  const view = control.ownerDocument.defaultView
  if (form == null || view == null || view.location.origin !== arg.origin) return false
  const prop = (key: string) => Reflect.get(view.HTMLFormElement.prototype, key, form)
  const eligible = (value: Element): value is HTMLButtonElement | HTMLInputElement => {
    if (!(value instanceof view.HTMLButtonElement || value instanceof view.HTMLInputElement)) return false
    const candidate = value as HTMLButtonElement | HTMLInputElement
    return !candidate.disabled && (candidate.type === 'submit' || candidate.type === 'image')
  }
  const submit = eligible(control) ? control : Array.from(prop('elements') as Element[]).find(eligible)
  const method = submit?.hasAttribute('formmethod') === true ? submit.formMethod : prop('method')
  const action = submit?.hasAttribute('formaction') === true ? submit.formAction : prop('action')
  try { const url = new view.URL(action); return method === 'post' &&
    url.protocol === 'https:' && url.origin === arg.origin }
  catch { return false }
}

export function fillAuthInput(element: Element, injected: any, arg: {
  operation: string; expectedType: string; expectedOrigin: string; value: string;
  nativeSubmitSelector?: string
}) {
  const target = injected.retarget(element, 'follow-label')
  const view = target?.ownerDocument.defaultView
  if (view == null || view.location.origin !== arg.expectedOrigin ||
    !(target instanceof view.HTMLInputElement) || target.type !== arg.expectedType)
    throw Error('Browser auth field is no longer a trusted input')
  for (const state of ['visible', 'enabled', 'editable'])
    if (!injected.elementState(target, state).matches)
      throw Error(`Browser auth field is not ${state}`)
  target.scrollIntoView({ block: 'center', inline: 'nearest' })
  const checkNativeForm = () => {
    if (arg.nativeSubmitSelector == null) return
    const matches = injected.querySelectorAll(
      injected.parseSelector(arg.nativeSubmitSelector), target.ownerDocument.documentElement)
    const submit = matches[0]
    if (matches.length !== 1 ||
      !(submit instanceof view.HTMLButtonElement || submit instanceof view.HTMLInputElement) ||
      submit.form == null || submit.form !== target.form)
      throw Error('Browser auth native form changed')
    const form = submit.form
    const formProperty = (key: string) => Reflect.get(view.HTMLFormElement.prototype, key, form)
    const eligible = (control: Element) => {
      if (!(control instanceof view.HTMLButtonElement || control instanceof view.HTMLInputElement))
        return false
      const candidate = control as HTMLButtonElement | HTMLInputElement
      return !candidate.disabled && (candidate.type === 'submit' || candidate.type === 'image')
    }
    const actual = eligible(submit) ? submit :
      Array.from(formProperty('elements') as Element[]).find(eligible) as HTMLButtonElement | HTMLInputElement | undefined
    const method = actual?.hasAttribute('formmethod') === true ? actual.formMethod : formProperty('method')
    const action = actual?.hasAttribute('formaction') === true ? actual.formAction : formProperty('action')
    const url = new view.URL(action)
    if (method !== 'post' || url.protocol !== 'https:' || url.origin !== view.location.origin)
      throw Error('Browser auth native submission changed')
  }
  checkNativeForm()
  const result = injected.fill(target, arg.value)
  if (result === 'done') return
  if (result !== 'needsinput' || !target.isConnected)
    throw Error('Browser auth field cannot be filled')
  for (const state of ['visible', 'enabled', 'editable'])
    if (!injected.elementState(target, state).matches)
      throw Error(`Browser auth field is not ${state}`)
  const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set
  if (setter == null) throw Error('Browser auth field value cannot be updated')
  checkNativeForm()
  setter.call(target, arg.value)
  target.dispatchEvent(new view.InputEvent('input', {
    bubbles: true, composed: true, data: arg.value, inputType: 'insertReplacementText'
  }))
}

/** Fill ordinary broker fields through bound Playwright selectors after each fresh page check. */
export async function submitBrowserAuthForm(
  params: Params,
  values: Record<string, string>,
  selectedOption: string | undefined,
  context: Context
): Promise<Status> {
  const tabId = Number(params.tab_id)
  if (!Number.isSafeInteger(tabId) || tabId <= 0) return 'submission_failed'
  const selected = params.options?.find(({ id }) => id === selectedOption)
  if (params.options != null && selected == null) return 'submission_failed'
  if (selected?.selector != null && (selected.field_ids?.length ?? 0) === 0) {
    let rejected: Status | null = null
    try {
      await context.playwright.withBoundPlaywrightSelector(tabId, selected.selector,
        async () => ((rejected = await context.revalidate()), rejected == null),
        async (bound) => await bound.clickLocator({ tab_id: tabId, selector: selected.selector!,
          ...(params.timeout_ms == null ? {} : { timeout_ms: params.timeout_ms }) }, 1),
        { timeoutMs: params.timeout_ms })
      return rejected ?? 'submitted'
    } catch { return await context.revalidate() ?? 'submission_failed' }
  }
  if (selected?.selector != null) return 'submission_failed'
  if (context.nativeDelivery && params.submit == null) return 'locator_invalid'
  const nativeSubmitSelector = context.nativeDelivery
    ? params.submit!.selector.split(' >> internal:control=enter-frame >> ').at(-1)
    : undefined
  if (context.nativeDelivery && !nativeSubmitSelector) return 'locator_invalid'
  const groups = context.credentialPlan?.fillFields ??
    params.fields.map((field) => ({ promptId: field.id, fields: [field] }))
  const selectedFields = selected == null ? null : new Set(selected.field_ids ?? [])
  const allowedIds = new Set(selectedFields == null
    ? groups.map(({ promptId }) => promptId)
    : groups.filter(({ fields }) => fields.every(({ id }) => selectedFields.has(id)))
      .map(({ promptId }) => promptId))
  if (Object.keys(values).some((id) => !allowedIds.has(id))) return 'submission_failed'
  let rejected: Status | null = null
  let groupedOtp = false
  for (const group of groups) {
    const input = values[group.promptId]
    if (input == null) continue
    const parts = group.fields.length === 1 ? [input] :
      Array.from(input.trim().replace(/[\s-]+/g, ''))
    if (parts.length !== group.fields.length) return 'submission_failed'
    const numericOtp = group.promptId === 'otp' && parts.every((part) => /^[0-9]$/.test(part))
    groupedOtp ||= group.promptId === 'otp' && group.fields.length > 1
    for (const [index, field] of group.fields.entries()) {
    const value = parts[index]
    if (value == null) continue
    try {
      await context.playwright.withBoundPlaywrightSelector(tabId, field.selector,
        async () => ((rejected = await context.revalidate()), rejected == null),
        async (bound) => {
          if (numericOtp) {
            const press = context.pressLocator ?? bound.pressLocator?.bind(bound)
            if (press == null) throw Error('Browser auth key press is unavailable')
            await press({ tab_id: tabId, selector: field.selector, value,
              ...(params.timeout_ms == null ? {} : { timeout_ms: params.timeout_ms }) }, bound)
            return
          }
          await bound.evaluateOnPlaywrightSelectorWithTarget(params.tab_id, field.selector,
            fillAuthInput, { arg: {
              operation: 'browser-auth-fill', expectedType: field.type,
              expectedOrigin: params.origin, value,
              ...(nativeSubmitSelector == null ? {} : { nativeSubmitSelector })
            }, timeoutMs: params.timeout_ms,
            ...(context.nativeDelivery ? { isolatedWorld: true } : {}) })
        }, { timeoutMs: params.timeout_ms,
          ...(context.nativeDelivery ? { isolatedWorld: true } : {}) })
      if (rejected != null) return rejected
    } catch {
      return await context.revalidate() ?? 'submission_failed'
    }
    }
  }
  if (params.submit == null) return 'submitted'
  if (params.submit.action !== 'click' && params.submit.action !== 'press_enter') return 'submission_failed'
  if (groupedOtp && context.playwright.evaluateOnPlaywrightSelectorAll != null) {
    const deadline = Date.now() + 1000
    do {
      const changed = await context.revalidate()
      if (changed != null) return changed
      try {
        const count = await context.playwright.evaluateOnPlaywrightSelectorAll(
          params.tab_id, params.submit.selector, (elements) => elements.length,
          { timeoutMs: params.timeout_ms })
        if (count === 0) return await context.revalidate() ?? 'submitted'
        if (params.submit.action === 'press_enter' && context.playwright.readElementState != null) {
          const selector = { tab_id: params.tab_id, selector: params.submit.selector,
            ...(params.timeout_ms == null ? {} : { timeout_ms: params.timeout_ms }) }
          const [visible, enabled] = await Promise.all([
            context.playwright.readElementState(selector, 'visible'),
            context.playwright.readElementState(selector, 'enabled')
          ])
          if (!visible || !enabled) return await context.revalidate() ?? 'submitted'
        }
      } catch { /* A transient locator failure is not proof of auto-submission. */ }
      if (Date.now() >= deadline) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    // eslint-disable-next-line no-constant-condition -- deadline and submission exit above
    } while (true)
  }
  try {
    await context.playwright.withBoundPlaywrightSelector(tabId, params.submit.selector,
      async () => ((rejected = await context.revalidate()), rejected == null),
      async (bound) => {
        if (context.nativeDelivery) {
          if (bound.evaluateOnPlaywrightSelector == null ||
            await bound.evaluateOnPlaywrightSelector(params.tab_id, params.submit!.selector,
              nativeSubmitPage, { arg: { origin: params.origin },
                timeoutMs: params.timeout_ms, isolatedWorld: true }) !== true) {
            rejected = 'origin_changed'
            return
          }
        }
        const action = { tab_id: tabId, selector: params.submit!.selector,
          ...(params.timeout_ms == null ? {} : { timeout_ms: params.timeout_ms }) }
        if (params.submit!.action === 'click') await bound.clickLocator(action, 1)
        else {
          const press = context.pressLocator ?? bound.pressLocator?.bind(bound)
          if (press == null) throw Error('Browser auth key press is unavailable')
          await press({ ...action, value: 'Enter' }, bound)
        }
      }, { timeoutMs: params.timeout_ms,
        ...(context.nativeDelivery ? { isolatedWorld: true } : {}) })
    return rejected ?? 'submitted'
  } catch {
    return await context.revalidate() ?? 'submission_failed'
  }
}
