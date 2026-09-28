import { ComputerUseError, ServerErrorCode } from './errors.js'
import type { AppPolicyResult } from './types.js'
export type TerminalStatus = 'completed' | 'failed' | 'cancelled'
export interface TelemetrySink {
  toolCalled(event: {
    bundleIdentifier?: string | undefined
    durationMs: number
    terminalStatus: TerminalStatus
    toolName: string
  }): void
  approvalRequested(event: {
    bundleIdentifier: string
    toolName: string
    eventCreatedAt: string
  }): void
  approvalResolved(event: {
    bundleIdentifier: string
    toolName: string
    approvalResult: string
    approvalPersistence?: string
  }): void
  clientCreated(): void
}
export interface ApprovalResult {
  action: string
  content?: unknown
  _meta?: { persist?: unknown }
}
export interface PolicyHost {
  requestMeta?: Record<string, unknown>
  setResponseMeta?(meta: Record<string, unknown>): void
  createElicitation?(input: {
    message: string
    meta: Record<string, unknown>
  }): Promise<ApprovalResult>
  withSuspendedTimeout?<T>(operation: () => Promise<T>): Promise<T>
}
interface PolicyOptions {
  getClient: () => Promise<{ getAppPolicy(app: string): Promise<AppPolicyResult> }>
  getHost: () => PolicyHost | undefined
  telemetry: TelemetrySink
}
function snapshot<Input extends { app: string }>(
  input: Input,
  approvedPath?: string
): Readonly<Input> {
  if (typeof input !== 'object' || input === null)
    throw new Error('Computer Use app approval requires an object input')
  const descriptors = Object.getOwnPropertyDescriptors(input),
    app = descriptors.app
  if (!app || !('value' in app))
    throw new Error('Computer Use app approval requires app to be a plain data property')
  if (typeof app.value !== 'string' || app.value.trim() === '')
    throw new Error('Computer Use app approval requires a non-empty app')
  const result = {}
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor))
      throw new Error(`Computer Use app approval requires ${name} to be a plain data property`)
    Object.defineProperty(result, name, {
      configurable: false,
      enumerable: descriptor.enumerable ?? false,
      value: name === 'app' ? (approvedPath ?? app.value) : descriptor.value,
      writable: false
    })
  }
  return Object.freeze(result) as Readonly<Input>
}
function callId(host: PolicyHost | undefined): string | undefined {
  let value = host?.requestMeta?.['x-codex-turn-metadata']
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return
  for (const key of ['call_id', 'item_id']) {
    const id = Reflect.get(value, key)
    if (typeof id === 'string' && id.trim() !== '') return id.trim()
  }
}
export function createComputerUsePolicy({ getClient, getHost, telemetry }: PolicyOptions) {
  function requireHelper<K extends 'createElicitation' | 'withSuspendedTimeout'>(
    name: K
  ): NonNullable<PolicyHost[K]> {
    const helper = getHost()?.[name]
    if (typeof helper !== 'function') throw new Error(`Computer Use requires nodeRepl.${name}`)
    return helper as NonNullable<PolicyHost[K]>
  }
  function setResponseMeta(bundle: string | null): void {
    getHost()?.setResponseMeta?.({
      'codex/toolSurface': {
        app: bundle === null ? null : { appId: bundle, kind: 'appId' },
        kind: 'computerUse'
      },
      ...(bundle === 'com.google.Chrome' ? { 'codex/computerUseChrome': true } : {})
    })
  }
  async function withToolTelemetry<Result>(
    toolName: string,
    bundleIdentifier: string | undefined,
    operation: () => Promise<Result>
  ): Promise<Result> {
    const start = performance.now()
    let terminalStatus: TerminalStatus = 'completed'
    try {
      return await operation()
    } catch (error) {
      terminalStatus =
        error instanceof ComputerUseError &&
        (error.code === ServerErrorCode.userStoppedSession ||
          error.code === ServerErrorCode.userIntervened)
          ? 'cancelled'
          : 'failed'
      throw error
    } finally {
      telemetry.toolCalled({
        bundleIdentifier,
        durationMs: Math.min(2147483647, Math.max(0, Math.round(performance.now() - start))),
        terminalStatus,
        toolName
      })
    }
  }
  async function withPolicy<Input extends { app: string }, Result>(
    toolName: string,
    input: Input,
    operation: (approved: Readonly<Input>) => Promise<Result>
  ): Promise<Result> {
    setResponseMeta(null)
    const captured = snapshot(input),
      elicit = requireHelper('createElicitation'),
      suspend = requireHelper('withSuspendedTimeout')
    const policy = await (await getClient()).getAppPolicy(captured.app),
      target = policy.target,
      allowedTarget = policy.decision === 'allowed' ? target : undefined
    setResponseMeta(target.bundleIdentifier)
    if (policy.decision === 'denied')
      throw new Error(
        `Computer Use is blocked from using the app '${target.bundleIdentifier}' by your organization's policy.`
      )
    if (policy.decision === 'forbidden')
      throw new Error(
        `Computer Use is not allowed to use the app '${target.bundleIdentifier}' for safety reasons.`
      )
    const context = { bundleIdentifier: target.bundleIdentifier, toolName },
      eventCreatedAt = new Date().toISOString(),
      id = callId(getHost())
    const requested = () => telemetry.approvalRequested({ ...context, eventCreatedAt })
    let answer: ApprovalResult
    try {
      answer = await elicit({
        message: `Allow Computer Use to use "${target.displayName}"?`,
        meta: {
          codex_approval_kind: 'mcp_tool_call',
          connector_id: 'computer-use',
          connector_name: 'Computer Use',
          persist: policy.allowPersistentApproval ? ['session', 'always'] : ['session'],
          riskLevel: target.risk,
          ...(target.warningSubtitle == null ? {} : { subtitle: target.warningSubtitle }),
          ...(id == null ? {} : { tool_call_id: id }),
          tool_name: toolName,
          tool_params: { app: target.bundleIdentifier },
          tool_params_display: [{ name: 'app', display_name: 'App', value: target.displayName }]
        }
      })
    } catch (error) {
      requested()
      throw error
    }
    const persisted =
      answer.content !== null &&
      typeof answer.content === 'object' &&
      Reflect.get(answer.content, 'source') === 'computer-use-persisted-state'
    if (!persisted) {
      requested()
      const result = (
        { accept: 'accepted', cancel: 'canceled', decline: 'declined' } as Record<string, string>
      )[answer.action]
      if (result !== undefined)
        telemetry.approvalResolved({
          ...context,
          approvalResult: result,
          ...(result === 'accepted'
            ? { approvalPersistence: answer._meta?.persist === 'always' ? 'always' : 'session' }
            : {})
        })
    }
    if (answer.action !== 'accept')
      throw new Error(`Computer Use was not approved to use ${target.displayName}`)
    // The original policy boundary has no approved target for an unknown decision.
    const approved = snapshot(captured, allowedTarget!.appPath)
    return withToolTelemetry(toolName, target.bundleIdentifier, () =>
      suspend(() => operation(approved))
    )
  }
  async function requestAudioApproval(): Promise<void> {
    const elicit = requireHelper('createElicitation'),
      id = callId(getHost())
    const answer = await elicit({
      message: 'Allow Computer Use to record computer audio?',
      meta: {
        codex_approval_kind: 'mcp_tool_call',
        codex_request_type: 'approval_request',
        connector_id: 'computer-use',
        connector_name: 'Computer Use',
        persist: ['session'],
        riskLevel: 'high',
        ...(id == null ? {} : { tool_call_id: id }),
        tool_name: 'start_audio_recording',
        tool_params: {},
        tool_params_display: []
      }
    })
    if (answer.action !== 'accept')
      throw new Error('Computer Use was not approved to record computer audio')
  }
  return { withPolicy, withToolTelemetry, setResponseMeta, requestAudioApproval }
}
export type ComputerUsePolicy = ReturnType<typeof createComputerUsePolicy>
