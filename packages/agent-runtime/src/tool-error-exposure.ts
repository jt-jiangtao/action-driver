/**
 * Fixed Computer Use guidance failures that carry no screen content, JavaScript source or user
 * text. They stay readable in the tool result the model receives, in persisted invocation errors
 * and in the user interface, so a failed `js` call can be diagnosed and retried correctly. Every
 * other failure keeps the `[redacted N characters]` treatment: add a message here only when it is a
 * fixed literal that cannot embed runtime data.
 */
export const COMPUTER_USE_GUIDANCE_ERRORS = {
  skillNotLoaded: 'SKILL_NOT_LOADED: read the computer-use Skill with tools_local_skills_read',
  engineNotReady: 'ENGINE_UNAVAILABLE: Computer Use is not ready',
  inventoryInvalid: 'ENGINE_UNAVAILABLE: invalid application inventory',
  stateInvalid: 'ENGINE_UNAVAILABLE: invalid application state',
  screenshotEmpty: 'ENGINE_UNAVAILABLE: empty screenshot',
  contextRequired: 'COMPUTER_USE_CONTEXT_REQUIRED',
  codeUnavailable: 'COMPUTER_CODE_UNAVAILABLE: source was lost; start a new request',
  invalidInput: 'TOOL_INPUT_INVALID',
  appDenied: 'APP_DENIED',
  appForbidden: 'APP_FORBIDDEN',
  appBusy: 'APP_BUSY: application is in use by another session',
  approvalCancelled: 'CANCELLED: application approval cancelled'
} as const

const EXPOSABLE_MESSAGES: ReadonlySet<string> = new Set(
  Object.values(COMPUTER_USE_GUIDANCE_ERRORS)
)

/** True when a tool failure message is fixed guidance that must survive redaction. */
export function isExposableToolError(message: string): boolean {
  return EXPOSABLE_MESSAGES.has(message)
}
