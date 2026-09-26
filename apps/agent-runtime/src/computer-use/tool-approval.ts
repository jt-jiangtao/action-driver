/**
 * Raised while a tool runs when the action it just reached needs the user's consent.
 *
 * The tool call does not fail: the graph catches this, asks the user, and continues the same call
 * with a continuation decision, so the tool keeps whatever state it had (for the JavaScript entry,
 * the cell stays suspended exactly where it stopped).
 */
export class ToolApprovalRequired extends Error {
  readonly code = 'TOOL_APPROVAL_REQUIRED'

  constructor(
    readonly approval: { index: number; method: string; args: unknown }
  ) {
    super(`TOOL_APPROVAL_REQUIRED: ${approval.method} needs the user's confirmation`)
    this.name = 'ToolApprovalRequired'
  }
}
