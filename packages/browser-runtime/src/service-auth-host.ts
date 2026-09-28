import { inspectAuthFields } from './service-auth-command.js'
import { submitBrowserAuthForm } from './service-auth-submission.js'
import { pressLocator } from './service-playwright-press.js'

/** Host-side locator preflights and ordinary form actions. Native delivery requires a separate permit. */
export function createAuthHostAdapter(backend: { playwright: any; cdp?: any; clipboard?: any }): {
  canSubmit(params: any, plan?: { fillFields: Array<{ fields: unknown[] }> }): boolean
  validateForm(params: any): Promise<boolean>
  validateOptions(params: any): Promise<boolean>
  inspectFields(params: any): Promise<any[] | null>
  submitCredentials(params: any, values: Record<string, string>, selectedOption: string | undefined,
    revalidate: () => Promise<any>, options?: { nativeDelivery: boolean; credentialPlan?: any }): Promise<
      'submitted' | 'submission_failed' | 'page_changed' | 'origin_changed' | 'locator_invalid'>
} {
  const playwright = backend.playwright
  const count = async (params: any, selector: string) =>
    await playwright.evaluateOnPlaywrightSelectorAll(params.tab_id, selector,
      (elements: Element[]) => elements.length, { timeoutMs: params.timeout_ms }) === 1
  const states = async (params: any, selector: string, required: string[]) => {
    for (const state of required)
      if (await playwright.readElementState({ tab_id: params.tab_id, selector,
        timeout_ms: params.timeout_ms }, state) !== true) return false
    return true
  }
  const distinct = async (params: any, selectors: string[]) => {
    if (selectors.length < 2) return true
    if (!selectors.some((selector) => selector.includes(' >> internal:control=enter-frame >> ')))
      return await playwright.selectorsResolveToDistinctElements(
        params.tab_id, selectors, { timeoutMs: params.timeout_ms }) === true
    const identities = await Promise.all(selectors.map(async (selector) => {
      const { result, target } = await playwright.evaluateOnPlaywrightSelectorWithTarget(
        params.tab_id, selector, (element: Element) => {
          const local = window as typeof window & {
            __codexBrowserAuthElementIds?: WeakMap<Element, string>
            __codexBrowserAuthElementIdCounter?: number
          }
          local.__codexBrowserAuthElementIds ??= new WeakMap()
          let id = local.__codexBrowserAuthElementIds.get(element)
          if (id == null) {
            id = String((local.__codexBrowserAuthElementIdCounter ?? 0) + 1)
            local.__codexBrowserAuthElementIdCounter = Number(id)
            local.__codexBrowserAuthElementIds.set(element, id)
          }
          return id
        }, { timeoutMs: params.timeout_ms })
      return `${target.tabId}:${target.sessionId ?? ''}:${target.targetId ?? ''}:${result}`
    }))
    return new Set(identities).size === identities.length
  }
  const validateForm = async (params: any): Promise<boolean> => {
    try {
      for (const field of params.fields)
        if (!(await count(params, field.selector)) ||
          !(await states(params, field.selector, ['visible', 'enabled', 'editable']))) return false
      const selectors = params.fields.map(({ selector }: { selector: string }) => selector)
      if (params.submit != null) {
        if (!(await count(params, params.submit.selector)) ||
          !(await states(params, params.submit.selector,
            params.submit.action === 'click' ? ['visible', 'enabled'] : ['visible']))) return false
        if (params.submit.action !== 'press_enter') selectors.push(params.submit.selector)
      }
      return await distinct(params, selectors)
    } catch { return false }
  }
  const validateOptions = async (params: any): Promise<boolean> => {
    try {
      for (const option of params.options ?? [])
        if (option.selector != null && (!(await count(params, option.selector)) ||
          !(await states(params, option.selector, ['visible', 'enabled'])))) return false
      return await distinct(params, [
        ...params.fields.map(({ selector }: { selector: string }) => selector),
        ...(params.submit?.action === 'click' ? [params.submit.selector] : []),
        ...(params.options ?? []).flatMap(({ selector }: { selector?: string | null }) =>
          selector == null ? [] : [selector])
      ])
    } catch { return false }
  }
  return {
    canSubmit: (params, plan) =>
      (params.submit == null || ['click', 'press_enter'].includes(params.submit.action)) &&
      (params.options ?? []).every(({ selector, field_ids }: { selector?: string | null; field_ids?: string[] | null }) =>
        selector == null || (field_ids?.length ?? 0) === 0) &&
      (plan?.fillFields.every(({ fields }) => fields.length === 1 || fields.length >= 4) ?? true),
    validateForm,
    validateOptions,
    inspectFields: async (params: any) => await inspectAuthFields(params,
      { playwright, auth: { validateForm } } as any),
    submitCredentials: async (params: any, values: Record<string, string>, selectedOption: string | undefined,
      revalidate: () => Promise<any>, options?: { nativeDelivery: boolean; credentialPlan?: any }) =>
      await submitBrowserAuthForm(params, values, selectedOption,
        { playwright, revalidate, ...(options?.nativeDelivery ? { nativeDelivery: true } : {}),
          ...(options?.credentialPlan == null ? {} : { credentialPlan: options.credentialPlan }),
          pressLocator: async (action, bound) => await pressLocator(action,
            { playwright: bound as any, cdp: backend.cdp, clipboard: backend.clipboard } as any) })
  }
}
