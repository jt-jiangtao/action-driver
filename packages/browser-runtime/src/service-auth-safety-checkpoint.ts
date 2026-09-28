import { readBrowserDocument } from './service-resources.js'
import { securityFailure } from './service-security-approval.js'

/** The copied service requires these instructions before any auth review or prompt. */
export async function requireAuthSafetyInstructions(options: {
  environment: string
  browserBackend?: string
  elicitationDisplayName?: string
}): Promise<string> {
  try {
    const instructions = (await readBrowserDocument('browserAuthSafetyPrecheck', undefined, {
      environment: options.environment
    })).trim()
    if (!instructions) throw Error('Browser auth safety precheck instructions are empty.')
    return instructions
  } catch (error) {
    const name = options.elicitationDisplayName ?? 'Browser use'
    return securityFailure(
      { check: 'automated-safety-precheck', reason: 'approval_unavailable', options },
      `${name} encountered an error loading safety instructions to check if it is safe to request credentials for this site. ${name} stopped before creating a user prompt or action.`,
      error
    )
  }
}

interface AuthSafetyCheckpoint {
  revalidateForReview(): Promise<string | null>
  revalidate(): Promise<string | null>
}

/** Internal tk orchestration; callers must supply the bound DOM and credential checkpoint. */
export async function runAuthSafetyCheckpoint(input: {
  environment: string
  browserBackend?: string
  elicitationDisplayName?: string
  params: { browser_id: string; tab_id: string; timeout_ms?: number }
  actionTargets: {
    options: Array<{ id: string; accessible_name: string; origin: string }>
    submit?: { action: string; accessible_name: string }
    submissionOrigin: string
  }
  credentialFieldMetadata: unknown
  credentialFrameId: string
  credentialFrameOrigin: string
  proposedUserPrompt: { origin: string; [key: string]: unknown }
  checkpoint: AuthSafetyCheckpoint
  captureVisibleDom(
    params: { browser_id: string; tab_id: string; timeout_ms?: number },
    frameId: string,
    capturedFrameIds: Set<string>
  ): Promise<string>
  createAutomatedSafetyPrecheck(request: {
    message: string
    toolName: string
    toolParams: unknown
  }): Promise<unknown>
  captureScreenshotAndValidateLocators(): Promise<string | null>
}): Promise<string | null> {
  const options = {
    environment: input.environment,
    ...(input.browserBackend === undefined ? {} : { browserBackend: input.browserBackend }),
    ...(input.elicitationDisplayName === undefined ? {} : {
      elicitationDisplayName: input.elicitationDisplayName
    })
  }
  const name = input.elicitationDisplayName ?? 'Browser use'
  const instructions = await requireAuthSafetyInstructions(options)
  let snapshot: string | undefined
  let snapshotError: unknown
  try {
    const capturedFrameIds = new Set<string>()
    snapshot = await input.captureVisibleDom(input.params, input.credentialFrameId, capturedFrameIds)
    if (!capturedFrameIds.has(input.credentialFrameId))
      throw Error('The authentication frame was missing from the visible DOM')
  } catch (error) {
    snapshotError = error
    snapshot = undefined
  }
  if (!snapshot?.trim()) {
    const status = await revalidate(input.checkpoint, true, options)
    if (status !== null) return status
    return securityFailure(
      { check: 'automated-safety-precheck', reason: 'browser_context_unavailable', options },
      `${name} could not capture the page content required for safety review. ${name} stopped before creating a user prompt or action.`,
      snapshotError
    )
  }
  const status = await revalidate(input.checkpoint, true, options)
  if (status !== null) return status
  const review = input.createAutomatedSafetyPrecheck({
    message: instructions,
    toolName: 'review_browser_auth_safety',
    toolParams: {
      proposed_user_prompt: input.proposedUserPrompt,
      visible_browser_state: {
        action_targets: {
          options: input.actionTargets.options.map(({ id, accessible_name, origin }) => ({
            id, accessible_name, origin
          })),
          ...(input.actionTargets.submit === undefined ? {} : {
            submit: {
              action: input.actionTargets.submit.action,
              accessible_name: input.actionTargets.submit.accessible_name
            }
          })
        },
        credential_field_metadata: input.credentialFieldMetadata,
        credential_frame_origin: input.credentialFrameOrigin,
        form_submission_origin: input.actionTargets.submissionOrigin,
        top_level_origin: input.proposedUserPrompt.origin,
        visible_page_content: { format: 'dom_cua_visible_dom', snapshot }
      }
    }
  })
  const [reviewResult, screenshotResult] = await Promise.allSettled([
    review, input.captureScreenshotAndValidateLocators()
  ])
  if (reviewResult.status === 'rejected') throw reviewResult.reason
  if (screenshotResult.status === 'rejected') throw screenshotResult.reason
  return screenshotResult.value != null
    ? screenshotResult.value
    : await revalidate(input.checkpoint, false, options)
}

async function revalidate(
  checkpoint: AuthSafetyCheckpoint,
  forReview: boolean,
  options: { browserBackend?: string; elicitationDisplayName?: string }
) {
  const status = forReview
    ? await checkpoint.revalidateForReview()
    : await checkpoint.revalidate()
  if (status === 'prompt_changed')
    return securityFailure(
      { check: 'automated-safety-precheck', reason: 'browser_context_unavailable', options },
      `The reviewed credential field labels changed or an authentication control changed during the authentication process. ${options.elicitationDisplayName ?? 'Browser use'} stopped before creating a user prompt or action.`
    )
  return status
}
