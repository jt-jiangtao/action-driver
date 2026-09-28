import { safeQrSignInUrl, type AuthQrCode } from './service-auth-qr.js'
import { selectedOptionAcceptsFields, validateSubmittedFields } from './service-auth-validation.js'

type AuthStatus = 'submitted' | 'declined' | 'cancelled' | 'unavailable' |
  'expired' | 'origin_changed' | 'page_changed' | 'locator_invalid' | 'submission_failed'
interface BrokerSubmission {
  fields: unknown
  selected_option?: string
  native_credential_delivery?: boolean
  ordinary_credential_delivery?: boolean
  manual_credential_save?: boolean
}
interface AuthChallenge {
  id: string
  hasSubmission: boolean
  waitForSubmission(): Promise<BrokerSubmission | { status: AuthStatus }>
  complete(status: AuthStatus): Promise<AuthStatus>
  publishQrCodePayload?(payload: string, disappeared?: boolean): void
  close(): void
}
interface ElicitationResponse {
  action: string
  _meta?: Record<string, unknown>
}
interface AuthChallengeContext {
  prompt: {
    origin: string
    frame_origin: string
    fields: unknown[]
    [key: string]: unknown
  }
  fields: Array<{ id: string; required: boolean }>
  options?: Array<{ id: string; field_ids?: string[] | null }>
  qrCode?: AuthQrCode
  qrOnly?: boolean
  screenshot?: unknown
  credentialBinding?: unknown
  manualSaveFields?: unknown
  manualSaveSessionId?: unknown
  createChallenge(
    fields: Array<{ id: string; required: boolean }>,
    options: Array<{ id: string; field_ids: string[] }> | undefined,
    metadata: Record<string, unknown>
  ): Promise<AuthChallenge>
  createElicitation(request: {
    message: string
    requestedSchema: { type: 'object'; properties: Record<string, never>; additionalProperties: false }
    meta: Record<string, unknown>
  }): Promise<ElicitationResponse>
  prepareDelivery?(submission: BrokerSubmission): Promise<void>
  submitCredentials(fields: Record<string, string>, selectedOption?: string): Promise<AuthStatus>
  watchQrCode?(publish: (payload: string, disappeared?: boolean) => void): { stop(): void }
}
const unavailable = { status: 'unavailable' } as const
async function completeSafely(challenge: AuthChallenge, status: AuthStatus): Promise<AuthStatus> {
  try { return await challenge.complete(status) } catch { return 'unavailable' }
}
/** Coordinates one trusted broker challenge after page, locator and safety preflights succeed. */
export async function runBrowserAuthChallenge(context: AuthChallengeContext): Promise<{
  status: AuthStatus
  selected_option?: string
  reason?: 'user_took_over'
}> {
  const selectedFieldIds = new Set(context.options?.flatMap((option) => option.field_ids ?? []))
  const challengeFields = context.fields
    .filter(({ id }) => context.options == null || selectedFieldIds.has(id))
    .map(({ id, required }) => ({ id, required: context.options == null ? required : false }))
  let challenge: AuthChallenge
  try {
    challenge = await context.createChallenge(
      challengeFields,
      context.options?.map(({ id, field_ids }) => ({ id, field_ids: field_ids ?? [] })),
      {
        qrCode: context.qrCode !== undefined,
        origins: { origin: context.prompt.origin, frame_origin: context.prompt.frame_origin },
        manualSaveFields: context.manualSaveFields,
        manualSaveSessionId: context.manualSaveSessionId,
        credentialBinding: context.credentialBinding
      }
    )
  } catch { return unavailable }
  const publish = (payload: string, disappeared?: boolean) =>
    challenge.publishQrCodePayload?.(payload, disappeared)
  const watcher = context.qrCode !== undefined && challenge.publishQrCodePayload !== undefined
    ? (publish(context.qrCode.payload), context.watchQrCode?.(publish))
    : undefined
  let status: AuthStatus | null = null
  let selectedOption: string | undefined
  const submissionTask = (async (): Promise<AuthStatus> => {
    try {
      const submission = await challenge.waitForSubmission()
      if ('status' in submission) return status = submission.status
      const values = validateSubmittedFields(submission.fields, challengeFields)
      if (values === null) throw Error('invalid credential fields')
      const option = submission.selected_option
      if (context.options !== undefined &&
        (option === undefined || !context.options.some(({ id }) => id === option)))
        throw Error('invalid selected option')
      if (context.options !== undefined) {
        const chosen = context.options.find(({ id }) => id === option)!
        if (!selectedOptionAcceptsFields(values, chosen, { promptFields: context.fields }))
          throw Error('credentials do not match selected option')
      }
      if (submission.native_credential_delivery === true ||
        submission.ordinary_credential_delivery === true ||
        submission.manual_credential_save === true) {
        if (context.prepareDelivery === undefined) throw Error('credential protection unavailable')
        await context.prepareDelivery(submission)
      }
      const result = await context.submitCredentials(values, option)
      if (result === 'submitted') selectedOption = option
      return status = await completeSafely(challenge, result)
    } catch {
      return status = await completeSafely(challenge, 'unavailable')
    }
  })()
  let response: ElicitationResponse
  try {
    response = await context.createElicitation({
      message: 'Sign in to continue',
      requestedSchema: { type: 'object', properties: {}, additionalProperties: false },
      meta: {
        codex_approval_kind: 'browser_auth',
        codex_requires_user_input: true,
        codex_guardian_compatible: false,
        browser_auth_challenge_id: challenge.id,
        ...context.prompt,
        ...(context.qrCode === undefined ? {} : {
          qr_code_payload: context.qrCode.payload,
          qr_code_only: context.qrOnly === true
        }),
        ...(context.qrCode === undefined || safeQrSignInUrl(context.qrCode.payload) === undefined
          ? {} : { qr_code_url: context.qrCode.payload }),
        ...(context.screenshot === undefined ? {} : { screenshot: context.screenshot })
      }
    })
  } catch (error) {
    await completeSafely(challenge, 'unavailable')
    if (challenge.hasSubmission) await submissionTask
    watcher?.stop()
    challenge.close()
    throw error
  }
  if (status === null && challenge.hasSubmission) await submissionTask
  else if (status === null) status = await completeSafely(challenge,
    response.action === 'decline' ? 'declined' : response.action === 'cancel' ? 'cancelled' : 'unavailable')
  watcher?.stop()
  challenge.close()
  if (response.action === 'decline' && status === 'declined' &&
    response._meta?.['openai/client_unsupported'] === true)
    throw Error('This ChatGPT client does not support secure browser authentication. Tell the user to update the ChatGPT app to the latest version before trying again.')
  if (response.action === 'decline' && status === 'declined' &&
    response._meta?.['openai/client_is_mobile'] === true && context.qrOnly === true) {
    const link = context.qrCode === undefined ? undefined : safeQrSignInUrl(context.qrCode.payload)
    throw link === undefined
      ? Error('This QR-code sign-in flow probably cannot be completed on a mobile device. Explain that the website requires a QR code the mobile app cannot use.')
      : Error(`This ChatGPT mobile client requires a QR-code sign-in link. Show the user this secure HTTPS sign-in URL exactly: ${new URL(link).href}\nAsk the user to open the link, complete sign-in, and report back when done. Do not say that the user declined or dismissed the request.`)
  }
  return response.action === 'decline' && status === 'declined' &&
    response._meta?.['openai/user_took_over'] === true
    ? { status: 'declined', reason: 'user_took_over' }
    : { status: status ?? 'unavailable', ...(selectedOption === undefined ? {} : { selected_option: selectedOption }) }
}
