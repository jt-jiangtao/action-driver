import { computerHelperRequest } from '@action-driver/runtime-contracts'
import type { AppApprovalBroker } from './app-approval-broker'
import type { ApplicationLeases } from './application-leases'
import type { ComputerCallContext } from './call-context'

/** The REPL proposes a helper operation; this trusted owner supplies identity and app approval. */
export function createOwnedSkySession(options: {
  broker: AppApprovalBroker
  leases: ApplicationLeases
  assertRunning(taskId: string): void
  invoke(input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  onExecutedText?(context: ComputerCallContext, text: string): void
  onNotice?(context: ComputerCallContext, text: string): void
}) {
  return {
    releaseTurn: (taskId: string) => options.leases.releaseTurn(taskId),
    releaseSession: (sessionId: string) => options.leases.releaseSession(sessionId),
    async invoke(input: unknown, context: ComputerCallContext) {
      options.assertRunning(context.taskId)
      if (context.signal?.aborted) throw new Error('CANCELLED: native call cancelled')
      const request = computerHelperRequest.parse(input)
      if (request.operation === 'session-start' || request.operation === 'session-end') return null
      if (request.operation === 'app-policy' || request.operation === 'permissions' ||
          request.operation === 'cancel' || request.operation === 'shutdown' ||
          request.operation === 'guidance') {
        throw new Error('INVALID_REQUEST: unsupported REPL operation')
      }
      if (request.operation === 'list-apps')
        return options.invoke(request, context.signal)
      const approved = await options.broker.authorizeApp(context, request.app, context.signal)
      options.assertRunning(context.taskId)
      options.leases.acquire(approved.bundleId, context)
      const result = await options.invoke({ ...request, sessionId: context.sessionId, app: approved.appPath }, context.signal)
      if (request.operation === 'act') {
        if (result && typeof result === 'object' && 'executed' in result && result.executed === true) {
          const action = request.action
          const text = action.type === 'type' || action.type === 'paste' ? action.text
            : action.type === 'set-value' ? action.value : undefined
          if (typeof text === 'string') options.onExecutedText?.(context, text)
        } else if (result && typeof result === 'object' && 'delivered' in result && result.delivered === true) {
          options.onNotice?.(context,
            '[Action-Driver] Input reached the app, but the app gave no confirmation it was received. ' +
            'Verify with getScreenshot() or getAXState() before relying on it.\n')
        }
      }
      return result
    }
  }
}
