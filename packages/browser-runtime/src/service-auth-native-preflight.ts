interface Field {
  id: string
  selector: string
  required: boolean
  labelMetadata: {
    accessible_name?: string | null
    autocomplete?: string | null
    input_type?: string
    input_name?: string | null
  }
}
interface Params {
  tab_id: string
  timeout_ms?: number
  fields: Array<Pick<Field, 'id' | 'selector' | 'required'>>
  submit?: { selector: string; action: string } | null
  options?: unknown
  qr_code?: boolean
}
interface Context {
  runtime: { requestMeta?: Record<string, unknown> }
  playwright: {
    evaluateOnPlaywrightSelector(
      tabId: string,
      selector: string,
      evaluate: (element: Element, injected: unknown, arg: { requirePost: true }) => unknown,
      options: { arg: { operation: string; requirePost: true }; isolatedWorld: true; timeoutMs: number | undefined }
    ): Promise<{ origin: string; url: string } | null | undefined>
  }
}
function sessionId(context: { runtime: { requestMeta?: Record<string, unknown> } }): string | undefined {
  let metadata = context.runtime.requestMeta?.['x-codex-turn-metadata']
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata) } catch { return undefined }
  }
  if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
  const value = metadata as Record<string, unknown>
  if (value.thread_source === 'subagent' && typeof value.thread_id === 'string') return value.thread_id
  return typeof value.session_id === 'string' ? value.session_id : undefined
}
function classify(fields: Field[]) {
  const eligible = fields.filter((field) => {
    const autocomplete = field.labelMetadata.autocomplete?.toLowerCase().split(/\s+/) ?? []
    const label = field.labelMetadata.accessible_name?.replace(/[\p{Dash}_\s]+/gu, ' ') ?? ''
    return !autocomplete.includes('one-time-code') && !autocomplete.includes('new-password') &&
      !/\b(?:[ht]?otp|one ?time(?: ?(?:password|passcode|code))?|verification code|security code|authentication code|2fa|mfa)\b/i.test(label)
  })
  const passwords = eligible.filter(({ labelMetadata }) => labelMetadata.input_type === 'password')
  const candidates = eligible.filter(({ labelMetadata }) => {
    const { input_type: type, autocomplete, accessible_name: name } = labelMetadata
    if (type == null || !['text', 'email', 'tel', 'number', 'search', 'url'].includes(type)) return false
    if (autocomplete?.toLowerCase().split(/\s+/).includes('username')) return true
    const label = name?.replace(/[\p{Dash}_\s]+/gu, ' ').trim() ?? ''
    if (/^(?:code|passcode|pin|token)[:*]?$/i.test(label)) return false
    return type !== 'number' ||
      /\b(?:user ?name|(?:user|login|account|customer|member|membership|rapid rewards) (?:id|number|no\.?))\b|^(?:account|login|user|member)[:*]?$/i.test(label)
  })
  const annotated = candidates.filter(({ labelMetadata }) =>
    labelMetadata.autocomplete?.toLowerCase().split(/\s+/).includes('username'))
  const usernames = annotated.length > 0 ? annotated : candidates
  const username = usernames.length === 1 ? usernames[0] : undefined
  const password = passwords.length === 1 ? passwords[0] : undefined
  return username != null && password != null && username.id !== password.id
    ? { username, password }
    : undefined
}
interface ManualSaveContext {
  runtime: { env: Record<string, string | undefined>; requestMeta?: Record<string, unknown> }
  inspectFields(): Promise<Field[] | null>
  playwright?: { evaluateOnPlaywrightSelector(tabId: string, selector: string,
    evaluate: Function, options: Record<string, unknown>): Promise<any> }
  cdp: {
    call(tabId: number, method: 'Page.getFrameTree' | 'DOM.getDocument', params?: { depth: -1; pierce: true }): Promise<any>
    browserAuthNewTargetCheck?(tabId: number): Promise<string>
  }
}
/** Manual-save v10 ordinary or v8 isolated private form preflight. */
export async function prepareAuthManualSaveBinding(
  params: Params,
  inspected: Field[],
  challengeFields: Array<{ id: string; required: boolean }>,
  origin: string,
  frameOrigin: string | undefined,
  context: ManualSaveContext
) {
  const ordinary = context.runtime.env.BROWSER_AUTH_BROKER_MANUAL_SAVE_BINDING_VERSION === '10'
  if (!ordinary && context.runtime.env.BROWSER_AUTH_BROKER_MANUAL_SAVE_BINDING_VERSION !== '8')
    return undefined
  const session = sessionId(context)
  if (!session || session.length > 256 || params.submit == null || params.qr_code === true ||
    frameOrigin == null || origin !== frameOrigin || new URL(origin).protocol !== 'https:')
    return undefined
  if (!ordinary && (inspected.length !== 2 || inspected.some(({ required }) => !required) ||
    challengeFields.length !== 2 || challengeFields.some(({ required }) => !required) ||
    params.options != null)) return undefined
  const match = classify(inspected)
  if (match == null || match.username.id === match.password.id ||
    !challengeFields.some(({ id }) => id === match.username.id) ||
    !challengeFields.some(({ id }) => id === match.password.id)) return undefined
  if (params.options != null &&
    !(params.options as Array<{ field_ids?: string[] }>).some(({ field_ids }) =>
      field_ids?.includes(match.username.id) && field_ids.includes(match.password.id)))
    return undefined
  if (!ordinary) {
    const usernameName = match.username.labelMetadata.input_name
    const passwordName = match.password.labelMetadata.input_name
    if (!usernameName || !passwordName || usernameName === passwordName ||
      usernameName.length > 256 || passwordName.length > 256 || context.playwright == null ||
      context.cdp.browserAuthNewTargetCheck == null) return undefined
    let target: { origin: string; url: string } | null | undefined
    try {
      target = await context.playwright.evaluateOnPlaywrightSelector(
        params.tab_id, params.submit.selector,
        (element: Element, _injected: unknown, arg: { requirePost: true }) => {
          const control = element as HTMLButtonElement | HTMLInputElement
          const form = control.form
          if (form == null) return null
          const prop = (key: string) => Reflect.get(HTMLFormElement.prototype, key, form)
          const eligible = (value: Element): value is HTMLButtonElement | HTMLInputElement =>
            (value instanceof HTMLButtonElement || value instanceof HTMLInputElement) &&
            !value.disabled && (value.type === 'submit' || value.type === 'image')
          const submit = eligible(control) ? control : Array.from(prop('elements') as Element[]).find(eligible)
          const method = submit?.hasAttribute('formmethod') === true ? submit.formMethod : prop('method')
          if (arg.requirePost && method !== 'post') return undefined
          const action = submit?.hasAttribute('formaction') === true ? submit.formAction : prop('action')
          try {
            const url = new URL(action)
            if (url.protocol === 'javascript:') return null
            url.hash = ''
            return url.protocol === 'https:' ? { origin: url.origin, url: url.href } : undefined
          } catch { return undefined }
        },
        { arg: { operation: 'browser-auth-submission-origin', requirePost: true },
          isolatedWorld: true, timeoutMs: params.timeout_ms }
      )
    } catch { return undefined }
    if (target == null || target.origin !== frameOrigin ||
      !(await checkPrivateAuthContainment(context.cdp as any, Number(params.tab_id), target.origin)))
      return undefined
    const submission = {
      username: { selector: match.username.selector, name: usernameName },
      password: { selector: match.password.selector, name: passwordName },
      submit: params.submit, target
    }
    try {
      if (!(await context.playwright.evaluateOnPlaywrightSelector(
        params.tab_id, match.username.selector, privateAuthFormPage,
        { arg: submission, isolatedWorld: true, timeoutMs: params.timeout_ms }
      ))) return undefined
    } catch { return undefined }
    return { kind: 'private' as const,
      fields: { username: match.username.id, password: match.password.id },
      target, names: { username: usernameName, password: passwordName },
      sessionId: session, submission }
  }
  const current = await context.inspectFields()
  const rechecked = current == null ? undefined : classify(current)
  if (rechecked?.username.id !== match.username.id || rechecked?.password.id !== match.password.id)
    return undefined
  try {
    const [{ frameTree }] = await Promise.all([
      context.cdp.call(Number(params.tab_id), 'Page.getFrameTree'),
      context.cdp.call(Number(params.tab_id), 'DOM.getDocument', { depth: -1, pierce: true })
    ])
    if (new URL(frameTree.frame.securityOrigin).origin !== origin) return undefined
  } catch { return undefined }
  return {
    kind: 'ordinary' as const,
    fields: { username: match.username.id, password: match.password.id },
    sessionId: session
  }
}
/** Version 1/2 native credential binding preflight, before any broker registration. */
export async function prepareAuthCredentialBinding(
  params: Params,
  inspected: Field[],
  origin: string,
  frameOrigin: string | undefined,
  context: Context
) {
  const session = sessionId(context)
  if (!session || session.length > 256 || params.options != null || params.qr_code === true ||
    frameOrigin == null || origin !== frameOrigin || new URL(origin).protocol !== 'https:')
    return undefined
  const match = classify(inspected)
  if (match == null || inspected.some(({ id, required }) =>
    required && id !== match.username.id && id !== match.password.id)) return undefined
  if (params.submit == null) return undefined
  let submitted
  try {
    submitted = await context.playwright.evaluateOnPlaywrightSelector(
      params.tab_id,
      params.submit.selector,
      (element, _injected, arg) => {
        const control = element as HTMLButtonElement | HTMLInputElement
        const form = control.form
        if (form == null) return null
        const prop = (key: string) => Reflect.get(HTMLFormElement.prototype, key, form)
        const eligible = (value: Element): value is HTMLButtonElement | HTMLInputElement =>
          (value instanceof HTMLButtonElement || value instanceof HTMLInputElement) &&
          !value.disabled && (value.type === 'submit' || value.type === 'image')
        const submit = eligible(control) ? control : Array.from(prop('elements') as Element[]).find(eligible)
        const method = submit?.hasAttribute('formmethod') === true ? submit.formMethod : prop('method')
        if (arg.requirePost && method !== 'post') return undefined
        const action = submit?.hasAttribute('formaction') === true ? submit.formAction : prop('action')
        try {
          const url = new URL(action)
          if (url.protocol === 'javascript:') return null
          url.hash = ''
          return url.protocol === 'https:' ? { origin: url.origin, url: url.href } : undefined
        } catch { return undefined }
      },
      { arg: { operation: 'browser-auth-submission-origin', requirePost: true },
        isolatedWorld: true, timeoutMs: params.timeout_ms }
    )
  } catch { return undefined }
  return submitted?.origin === frameOrigin
    ? {
        fields: [
          { id: match.username.id, kind: 'username' },
          { id: match.password.id, kind: 'password' }
        ],
        session_id: session,
        submission_origin: submitted.origin
      }
    : undefined
}
import { checkPrivateAuthContainment } from './service-auth-document-permit.js'
import { privateAuthFormPage } from './service-auth-private-form.js'
