import { captureAuthPageBinding } from './service-auth-page-binding.js'
import { revalidateAuthPageBinding } from './service-auth-page-binding.js'
import { captureAuthFormBinding, captureAuthOptionBindings, revalidateAuthFormBinding } from './service-auth-form-binding.js'
import { sameAuthRegistration, trustAuthFormOrigin } from './service-auth-frame-trust.js'
import { runBrowserAuthChallenge } from './service-auth-handler.js'
import { prepareAuthCredentialBinding, prepareAuthManualSaveBinding } from './service-auth-native-preflight.js'
import { requireAuthSafetyInstructions } from './service-auth-safety-checkpoint.js'
import { isQrOnlyAuth, mapAuthOptions, planCredentialFields, validateAuthSelectors, type AuthRequestShape } from './service-auth-validation.js'

type ChallengeContext = Parameters<typeof runBrowserAuthChallenge>[0]
type InspectedFields = Parameters<typeof planCredentialFields>[0]

interface AuthCommandParams extends AuthRequestShape {
  browser_id: string
  tab_id: string
  origin: string
  fields: Array<{ id: string; selector: string; label: string; type: string; required: boolean; autocomplete?: string | null }>
  timeout_ms?: number
}
interface AuthCommandContext {
  environment?: string
  elicitationDisplayName?: string
  clientInfo: {
    name: string
    type: string
    capabilities?: { tab?: Array<{ id: string }> }
  }
  cdp: Parameters<typeof captureAuthPageBinding>[2]['cdp']
  playwright?: Parameters<typeof captureAuthFormBinding>[1]['playwright'] & {
    evaluateOnPlaywrightSelector(
      tabId: string,
      selector: string,
      evaluate: (element: Element, injected: any, arg: { operation: string; expectedType: string }) => unknown,
      options: { arg: { operation: string; expectedType: string }; isolatedWorld?: boolean; strict?: boolean; timeoutMs: number | undefined }
    ): Promise<unknown>
  }
  runtime?: {
    env: Record<string, string | undefined>
    requestMeta?: Record<string, unknown>
    createElicitation?: ChallengeContext['createElicitation']
    gaas?: { getBrowserAuthBrokerChallenge?: ChallengeContext['createChallenge'] }
  }
  auth?: {
    inspectFields(params: AuthCommandParams): Promise<InspectedFields | null>
    validateForm(params: AuthCommandParams): Promise<boolean>
    validateOptions(params: AuthCommandParams): Promise<boolean>
    canSubmit?(params: AuthCommandParams, plan: ReturnType<typeof planCredentialFields>): boolean
    captureScreenshot?(params: AuthCommandParams): Promise<unknown>
    decodeQr?(screenshot: unknown, params: AuthCommandParams): Promise<ChallengeContext['qrCode']>
    submitCredentials(
      values: Record<string, string>, selectedOption?: string,
      revalidate?: () => Promise<'locator_invalid' | 'origin_changed' | 'page_changed' | null>,
      credentialPlan?: ReturnType<typeof planCredentialFields>, frameOrigin?: string
    ): ReturnType<ChallengeContext['submitCredentials']>
    prepareDelivery?(submission: Parameters<NonNullable<ChallengeContext['prepareDelivery']>>[0],
      details: { credentialBinding: unknown; manualSave: Awaited<ReturnType<typeof prepareAuthManualSaveBinding>>;
        pageFrameId: string; formFrameId: string | undefined }): Promise<void>
    cleanupDelivery?(): Promise<void>
    watchQrCode?(publish: (payload: string, disappeared?: boolean) => void,
      details: { initialPayload: string; qrOnly: boolean;
        pageBindingStatus(): Promise<'origin_changed' | 'page_changed' | 'locator_invalid' | null> }): { stop(): void }
  }
}
function userVisibleAuthInput(
  element: Element,
  injected: {
    elementState(element: Element, state: string): { matches: boolean }
  },
  arg: { expectedType: string }
): boolean | null {
  function specialOtp(input: Element): boolean {
    const rect = input.getBoundingClientRect()
    const siblings = input.nextElementSibling?.querySelectorAll(':scope > [aria-hidden="true"]')
    return input.tagName === 'INPUT' &&
      input.getAttribute('autocomplete')?.toLowerCase() === 'one-time-code' &&
      input.matches(':focus') && rect.width === 0 && rect.height === 0 &&
      Element.prototype.checkVisibility.call(input, { opacityProperty: true, visibilityProperty: true }) &&
      siblings != null && siblings.length > 1 &&
      siblings.length === (input as HTMLInputElement).maxLength &&
      Array.from(siblings).every((sibling) =>
        injected.elementState(sibling, 'visible').matches === true &&
        Element.prototype.checkVisibility.call(sibling, { opacityProperty: true }))
  }
  if (element.tagName !== 'INPUT' || (element as HTMLInputElement).type !== arg.expectedType ||
    (!injected.elementState(element, 'visible').matches && !specialOtp(element)) ||
    !injected.elementState(element, 'enabled').matches ||
    !injected.elementState(element, 'editable').matches) return null
  return Element.prototype.checkVisibility.call(element, { opacityProperty: true }) ||
    Array.from((element as HTMLInputElement).labels ?? []).some((label) =>
      injected.elementState(label, 'visible').matches &&
      Element.prototype.checkVisibility.call(label, { opacityProperty: true }))
}
function authFieldLabelMetadata(
  element: Element,
  injected: { utils: { getElementAccessibleName(element: Element, includeHidden: boolean): string | null } },
  arg: { expectedType: string }
) {
  if (element.tagName !== 'INPUT') return null
  const input = element as HTMLInputElement
  if (input.type !== arg.expectedType) return null
  const compact = (value: string | null | undefined) => {
    const text = value?.replace(/\s+/g, ' ').trim() ?? ''
    return text.length === 0 ? null : text.length <= 80 ? text : `${text.slice(0, 79)}\u2026`
  }
  return {
    accessible_name: compact(injected.utils.getElementAccessibleName(input, false)),
    autocomplete: compact(input.autocomplete.toLowerCase()),
    input_type: input.type,
    input_mode: compact(input.inputMode.toLowerCase()),
    input_name: compact(input.name),
    required: input.required === true
  }
}
export async function inspectAuthFields(
  params: AuthCommandParams,
  context: Pick<AuthCommandContext, 'playwright' | 'auth'>,
  isolatedWorld = false,
  skipFormCheck = false
): Promise<InspectedFields | null> {
  try {
    if (!skipFormCheck && !(await context.auth?.validateForm(params))) return null
    const fields: InspectedFields = []
    for (const field of params.fields) {
      const metadata = await context.playwright!.evaluateOnPlaywrightSelector(
        params.tab_id, field.selector, authFieldLabelMetadata,
        {
          arg: { operation: 'browser-auth-field-label-metadata', expectedType: field.type },
          ...(isolatedWorld ? { isolatedWorld: true } : {}),
          timeoutMs: params.timeout_ms
        } as any
      ) as ReturnType<typeof authFieldLabelMetadata>
      if (metadata == null) return null
      const { required, ...labelMetadata } = metadata
      fields.push({ ...field, required: field.required || required, labelMetadata })
    }
    return fields
  } catch { return null }
}
export async function findInvisibleAuthField(
  params: AuthCommandParams,
  context: Pick<AuthCommandContext, 'playwright'>
): Promise<string | null> {
  for (const field of params.fields) {
    let visible: boolean | null = null
    try {
      visible = await context.playwright!.evaluateOnPlaywrightSelector(
        params.tab_id,
        field.selector,
        userVisibleAuthInput,
        {
          arg: { operation: 'browser-auth-user-visibility', expectedType: field.type },
          isolatedWorld: true,
          strict: false,
          timeoutMs: params.timeout_ms
        }
      ) as boolean | null
    } catch { visible = null }
    if (visible === false) return field.id
  }
  return null
}
/** Service command entry; the remaining trusted preflight is assembled below this boundary. */
export async function executeBrowserAuthCommand(
  params: AuthCommandParams,
  context: AuthCommandContext
): Promise<{ status: string; locator_error?: { field_id: string; reason: 'not_user_visible' } }> {
  if (context.clientInfo.capabilities?.tab?.some(({ id }) => id === 'browserAuth') !== true)
    throw Error(`${context.clientInfo.name} does not support command "tab_browser_auth_handoff".`)
  if (!validateAuthSelectors(params)) return { status: 'locator_invalid' }
  const page = await captureAuthPageBinding(params.tab_id, params.origin, context)
  if (typeof page === 'string') return { status: page }
  const securityOrigin = new URL(page.securityOrigin)
  if (securityOrigin.protocol !== 'http:' && securityOrigin.protocol !== 'https:')
    return { status: 'origin_changed' }
  if (context.playwright !== undefined) {
    const hidden = await findInvisibleAuthField(params, context)
    if (hidden !== null)
      return { status: 'locator_invalid', locator_error: { field_id: hidden, reason: 'not_user_visible' } }
  }
  const auth = context.auth
  const playwright = context.playwright
  if (auth === undefined || playwright === undefined) return { status: 'unavailable' }
  const qrOnly = isQrOnlyAuth(params)
  const safetyEnabled = context.runtime?.env.BROWSER_USE_AUTOMATED_SAFETY_PRECHECKS_ENABLED === '1' &&
    context.runtime.env.BROWSER_USE_SECURITY_MODE?.trim() === 'gaas-browser-environment'
  const inspected = qrOnly ? [] : await auth.inspectFields(params)
  if (inspected == null || (!qrOnly && !(await auth.validateForm(params))))
    return { status: 'locator_invalid' }
  if (!(await auth.validateOptions(params))) return { status: 'locator_invalid' }
  const form = qrOnly ? null : await captureAuthFormBinding(params, { playwright })
  if (!qrOnly && form == null) return { status: 'locator_invalid' }
  const options = await captureAuthOptionBindings(params, { playwright })
  if (options == null) return { status: 'locator_invalid' }
  if (form != null && !(await trustAuthFormOrigin(page, form, params, { playwright })))
    return { status: 'locator_invalid' }
  const pageStatus = await revalidateAuthPageBinding(params.tab_id, params.origin, page, context)
  if (pageStatus !== null) return { status: pageStatus }
  const plan = planCredentialFields(inspected)
  if (auth.canSubmit?.(params, plan) === false) return { status: 'unavailable' }
  const mapped = mapAuthOptions(params.options, plan)
  if (mapped === null) return { status: 'locator_invalid' }
  const prompt: ChallengeContext['prompt'] = {
    connector_id: 'browser-use', connector_name: 'Browser use',
    ...(form != null && !sameAuthRegistration(page, form)
      ? { cross_origin_iframe: { origin: form.origin } } : {}),
    fields: plan.promptFields.map((field) => {
      const metadata = field.label_metadata as Record<string, unknown>
      return {
        ...field,
        label_metadata: {
          accessible_name: metadata.accessible_name,
          autocomplete: metadata.autocomplete,
          input_type: metadata.input_type,
          input_name: metadata.input_name
        }
      }
    }),
    frame_origin: form?.origin ?? securityOrigin.origin,
    origin: securityOrigin.origin,
    ...(params.qr_code === true ? { qr_code: true } : {}),
    reason: 'Sign in to continue',
    ...(mapped == null ? {} : {
      options: mapped.map(({ id, field_ids, label }) => ({ id, label, field_ids: field_ids ?? [] }))
    })
  }
  // Original tk requires trusted instructions, a reviewer DOM snapshot, concurrent
  // screenshot/locator checks and a bound checkpoint. No single callback substitutes it.
  if (safetyEnabled) {
    await requireAuthSafetyInstructions({
      environment: context.environment ?? 'codex-app',
      browserBackend: context.clientInfo.type,
      ...(context.elicitationDisplayName === undefined ? {} : {
        elicitationDisplayName: context.elicitationDisplayName
      })
    })
    return { status: 'unavailable' }
  }
  const screenshot = await auth.captureScreenshot?.(params)
  const qrCode = params.qr_code === true && screenshot !== undefined
    ? await auth.decodeQr?.(screenshot, params)
    : undefined
  if (params.qr_code === true && qrCode == null) return { status: 'unavailable' }
  const createChallenge = context.runtime?.gaas?.getBrowserAuthBrokerChallenge
  if (createChallenge === undefined) throw Error('Browser auth broker is unavailable')
  const createElicitation = context.runtime?.createElicitation
  if (createElicitation === undefined) return { status: 'unavailable' }
  const challengeFields = plan.promptFields
    .filter(({ id }) => mapped == null || mapped.some(({ field_ids }) => field_ids?.includes(id)))
    .map(({ id, required }) => ({ id, required: mapped == null ? required : false }))
  const bindingVersion = context.runtime?.env.BROWSER_AUTH_BROKER_CREDENTIAL_BINDING_VERSION
  let credentialBinding: unknown = bindingVersion === '1' || bindingVersion === '2'
    ? await prepareAuthCredentialBinding(
        params, inspected, securityOrigin.origin, form?.origin,
        { runtime: context.runtime!, playwright: playwright as any }
      )
    : undefined
  const manualVersion = context.runtime?.env.BROWSER_AUTH_BROKER_MANUAL_SAVE_BINDING_VERSION
  const manualSave = manualVersion === '8' || manualVersion === '10'
    ? await prepareAuthManualSaveBinding(
        params, inspected, challengeFields, securityOrigin.origin, form?.origin,
        {
          runtime: context.runtime!,
          inspectFields: async () => await auth.inspectFields(params),
          playwright: context.playwright as any,
          cdp: context.cdp as any
        }
      )
    : undefined
  if (bindingVersion === '2' && manualSave?.kind === 'ordinary' && mapped == null &&
    challengeFields.every(({ id, required }) => !required ||
      id === manualSave.fields.username || id === manualSave.fields.password) && form != null)
    credentialBinding = {
      fields: [
        { id: manualSave.fields.username, kind: 'username' },
        { id: manualSave.fields.password, kind: 'password' }
      ],
      session_id: manualSave.sessionId,
      submission_origin: form.origin,
      submission: 'ordinary'
    }
  try {
    return await runBrowserAuthChallenge({
    prompt,
    fields: plan.promptFields.map(({ id, required }) => ({ id, required })),
    ...(mapped == null ? {} : { options: mapped.map(({ id, field_ids }) => ({ id, field_ids: field_ids ?? [] })) }),
    ...(qrCode == null ? {} : { qrCode }),
    qrOnly,
    ...(credentialBinding == null ? {} : { credentialBinding }),
    ...(manualSave == null ? {} : {
      manualSaveFields: manualSave.fields,
      manualSaveSessionId: manualSave.sessionId
    }),
    ...(screenshot === undefined ? {} : { screenshot }),
    createChallenge,
    createElicitation,
    ...(auth.prepareDelivery == null ? {} : { prepareDelivery: async (submission) =>
      await auth.prepareDelivery!(submission, { credentialBinding, manualSave,
        pageFrameId: page.frameId, formFrameId: form?.frameId }) }),
    ...(auth.watchQrCode == null || qrCode == null ? {} : {
      watchQrCode: (publish: (payload: string, disappeared?: boolean) => void) =>
        auth.watchQrCode!(publish, { initialPayload: qrCode.payload, qrOnly,
          pageBindingStatus: async () => await revalidateAuthPageBinding(
            params.tab_id, params.origin, page, context) })
    }),
    submitCredentials: async (values, selectedOption) => {
      const changed = await revalidateAuthPageBinding(params.tab_id, params.origin, page, context)
      if (changed !== null) return changed
      if (form != null) {
        const status = await revalidateAuthFormBinding(params, form, { playwright })
        if (status !== null) return status
      }
      return await auth.submitCredentials(values, selectedOption, async () => {
        const pageResult = await revalidateAuthPageBinding(params.tab_id, params.origin, page, context)
        if (pageResult !== null) return pageResult
        return form == null ? null : await revalidateAuthFormBinding(params, form, { playwright })
      }, plan, form?.origin)
    }
    })
  } finally {
    await auth.cleanupDelivery?.()
  }
}
