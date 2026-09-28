import { randomUUID } from 'node:crypto'
import type { AppApprovalRequest, AppApprovalDecision } from '@actiondriver/contracts'
import { appApprovalRequestSchema } from '@actiondriver/runtime-contracts'
import { z } from 'zod'
import { COMPUTER_USE_GUIDANCE_ERRORS } from '../tool-error-exposure'
export type { AppApprovalRequest, AppApprovalDecision } from '@actiondriver/contracts'

export class AppApprovalError extends Error {
  constructor(
    readonly code: 'APPROVAL_STALE' | 'INVALID_REQUEST',
    message: string
  ) {
    super(`${code}: ${message}`)
    this.name = 'AppApprovalError'
  }
}

export const appPolicySchema = z
  .object({
    decision: z.enum(['allowed', 'denied', 'forbidden']),
    allowPersistentApproval: z.boolean(),
    target: appApprovalRequestSchema.shape.target
  })
  .strict()
export type AppPolicy = z.infer<typeof appPolicySchema>
export type AppApprovalEvent =
  | { type: 'computer.app-approval.requested'; request: AppApprovalRequest }
  | {
      type: 'computer.app-approval.resolved'
      request: AppApprovalRequest
      decision: AppApprovalDecision | 'cancelled'
    }
export type AppApprovalOptions = {
  queryPolicy(app: string): Promise<AppPolicy>
  isAlwaysAllowed(bundleId: string): Promise<boolean>
  persistAlwaysAllowed(bundleId: string): Promise<void>
  emit(event: AppApprovalEvent): void | Promise<void>
  withSuspendedTimeout(taskId: string, wait: () => Promise<void>): Promise<void>
}
type Pending = {
  request: AppApprovalRequest
  deciding: boolean
  cancelled: boolean
  resolve(decision: AppApprovalDecision): Promise<void>
  reject(error: Error): Promise<void>
}

/** Only the trusted host may provide policy, persistence and decision transport. */
export class AppApprovalBroker {
  private readonly approvals = new Map<string, Set<string>>()
  private readonly pending = new Map<string, Pending>()

  constructor(private readonly options: AppApprovalOptions) {}

  async authorize(
    context: { taskId: string; sessionId: string },
    input: unknown,
    signal?: AbortSignal
  ): Promise<Readonly<Record<string, unknown>>> {
    // Copy synchronously before any await; getters and caller mutation cannot change the request.
    const snapshot = copyData(input) as Record<string, unknown> | null
    if (
      typeof snapshot !== 'object' ||
      snapshot === null ||
      Array.isArray(snapshot) ||
      typeof snapshot.app !== 'string' ||
      !snapshot.app.trim()
    ) {
      throw new Error('INVALID_REQUEST: a non-empty app is required')
    }
    const checkCancelled = () => {
      if (signal?.aborted) throw new Error(COMPUTER_USE_GUIDANCE_ERRORS.approvalCancelled)
    }
    checkCancelled()
    const target = await this.authorizeApp(context, snapshot.app, signal)
    return Object.freeze({ ...snapshot, app: target.appPath })
  }

  /** Trusted callers need the canonical bundle ID for a lease without re-querying policy. */
  async authorizeApp(context: { taskId: string; sessionId: string }, app: string,
    signal?: AbortSignal): Promise<Readonly<{ appPath: string; bundleId: string }>> {
    if (!app.trim()) throw new Error('INVALID_REQUEST: a non-empty app is required')
    if (signal?.aborted) throw new Error(COMPUTER_USE_GUIDANCE_ERRORS.approvalCancelled)
    const policy = appPolicySchema.parse(await this.options.queryPolicy(app))
    await this.requestApproval(context, policy, signal)
    return Object.freeze({ appPath: policy.target.appPath, bundleId: policy.target.bundleId })
  }

  /** Trusted sky/service policy port; the model must never supply this policy. */
  async requestApproval(
    context: { taskId: string; sessionId: string },
    input: AppPolicy,
    signal?: AbortSignal
  ): Promise<void> {
    const policy = appPolicySchema.parse(copyData(input))
    const checkCancelled = () => {
      if (signal?.aborted) throw new Error(COMPUTER_USE_GUIDANCE_ERRORS.approvalCancelled)
    }
    checkCancelled()
    if (policy.decision !== 'allowed') {
      throw new Error(
        policy.decision === 'forbidden'
          ? COMPUTER_USE_GUIDANCE_ERRORS.appForbidden
          : COMPUTER_USE_GUIDANCE_ERRORS.appDenied
      )
    }
    const id = policy.target.bundleId
    const persistent = policy.allowPersistentApproval && (await this.options.isAlwaysAllowed(id))
    checkCancelled()
    if (!this.approvals.get(context.sessionId)?.has(id) && !persistent) {
      await this.options.withSuspendedTimeout(context.taskId, async () => {
        checkCancelled()
        await this.waitForDecision(context, policy, signal)
      })
    }
    checkCancelled()
  }

  getPending(taskId: string): readonly AppApprovalRequest[] {
    return [...this.pending.values()]
      .filter((p) => p.request.taskId === taskId && !p.cancelled)
      .map((p) => p.request)
  }

  async decide(taskId: string, requestId: string, decision: AppApprovalDecision): Promise<void> {
    const pending = this.pending.get(requestId)
    if (!pending || pending.request.taskId !== taskId || pending.deciding) {
      throw new AppApprovalError('APPROVAL_STALE', 'approval does not belong to this active task')
    }
    if (!['once', 'session', 'always', 'deny'].includes(decision))
      throw new AppApprovalError('INVALID_REQUEST', 'invalid approval decision')
    if (decision === 'always' && !pending.request.allowPersistentApproval) {
      throw new AppApprovalError('INVALID_REQUEST', 'persistent approval is not permitted')
    }
    pending.deciding = true
    try {
      if (decision === 'always')
        await this.options.persistAlwaysAllowed(pending.request.target.bundleId)
      // Cancellation may have won while persistence was in progress.
      if (this.pending.get(requestId) !== pending)
        throw new AppApprovalError('APPROVAL_STALE', 'approval was cancelled')
      await pending.resolve(decision)
    } catch (error) {
      if (this.pending.get(requestId) === pending)
        await pending.reject(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    await Promise.all(
      [...this.pending.values()]
        .filter((p) => p.request.taskId === taskId)
        .map((p) => p.reject(new Error('CANCELLED: task ended')))
    )
  }

  async endSession(sessionId: string): Promise<void> {
    this.approvals.delete(sessionId)
    await Promise.all(
      [...this.pending.values()]
        .filter((p) => p.request.sessionId === sessionId)
        .map((p) => p.reject(new Error('CANCELLED: session ended')))
    )
  }

  private waitForDecision(
    context: { taskId: string; sessionId: string },
    policy: AppPolicy,
    signal?: AbortSignal
  ): Promise<void> {
    const request: AppApprovalRequest = Object.freeze({
      requestId: randomUUID(),
      // Only the persisted fields: the caller's context also carries an AbortSignal for the wait.
      taskId: context.taskId,
      sessionId: context.sessionId,
      target: Object.freeze({ ...policy.target }),
      allowPersistentApproval: policy.allowPersistentApproval
    })
    return new Promise((resolve, reject) => {
      let publishRequested!: (value: void | PromiseLike<void>) => void
      let rejectRequested!: (error: unknown) => void
      const requested = new Promise<void>((resolve, reject) => {
        publishRequested = resolve
        rejectRequested = reject
      })
      void requested.catch((error) => {
        if (this.pending.get(request.requestId) === pending) {
          cleanup()
          reject(error)
        }
      })
      let cancellation: Promise<void> | undefined
      const cleanup = () => {
        this.pending.delete(request.requestId)
        signal?.removeEventListener('abort', cancel)
      }
      const notify = async (decision: AppApprovalDecision | 'cancelled') => {
        await requested
        await this.options.emit({ type: 'computer.app-approval.resolved', request, decision })
      }
      const cancel = () => {
        void pending.reject(new Error(COMPUTER_USE_GUIDANCE_ERRORS.approvalCancelled))
      }
      const pending: Pending = {
        request,
        deciding: false,
        cancelled: false,
        resolve: async (decision) => {
          await notify(decision)
          if (this.pending.get(request.requestId) !== pending || pending.cancelled) {
            throw new AppApprovalError('APPROVAL_STALE', 'approval was cancelled')
          }
          cleanup()
          if (decision === 'session') {
            let approved = this.approvals.get(context.sessionId)
            if (!approved) this.approvals.set(context.sessionId, (approved = new Set()))
            approved.add(policy.target.bundleId)
          }
          if (decision === 'deny')
            reject(new Error('APP_NOT_APPROVED: user denied application access'))
          else resolve()
        },
        reject: (error) => {
          if (cancellation) return cancellation
          pending.cancelled = true
          pending.deciding = true
          reject(error)
          cancellation = (async () => {
            try {
              await notify('cancelled')
            } catch {
              /* cancellation must settle even if delivery fails */
            } finally {
              cleanup()
            }
          })()
          return cancellation
        }
      }
      this.pending.set(request.requestId, pending)
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) {
        publishRequested()
        cancel()
        return
      }
      try {
        publishRequested(this.options.emit({ type: 'computer.app-approval.requested', request }))
      } catch (error) {
        rejectRequested(error)
      }
    })
  }
}

/** Arguments are JSON data, never accessors, functions, cyclic objects or class instances. */
function copyData(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object' || value === null || ancestors.has(value))
    throw new Error('INVALID_REQUEST: expected acyclic JSON data')
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new Error('INVALID_REQUEST: expected plain data')
  }
  ancestors.add(value)
  const result: Record<string, unknown> | unknown[] = Array.isArray(value)
    ? []
    : (Object.create(null) as Record<string, unknown>)
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor)) throw new Error('INVALID_REQUEST: accessors are not permitted')
    if (Array.isArray(value) && key === 'length') continue
    Object.defineProperty(result, key, {
      value: copyData(descriptor.value, ancestors),
      enumerable: descriptor.enumerable === true
    })
  }
  ancestors.delete(value)
  return Object.freeze(result)
}
