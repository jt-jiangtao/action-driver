import { appPolicySchema, type AppApprovalBroker, type AppPolicy } from './app-approval-broker'
import type { ApplicationLeases } from './application-leases'
import { createCodexNativeClient, type CodexCallContext } from './codex-native-client'

type Options = Parameters<typeof createCodexNativeClient>[0] & {
  vendorRoot: string
  serviceModule: string
  broker: AppApprovalBroker
  leases: ApplicationLeases
  assertRunning(taskId: string): void
  withSuspendedTimeout<T>(taskId: string, operation: () => Promise<T>): Promise<T>
}
type Service = { handleRpc(input: unknown, context: CodexCallContext): Promise<unknown> }

/** One trusted original sky/service instance per Computer Use session. */
export async function createCodexSkySession(options: Options) {
  const module = (await import(options.serviceModule)) as {
    createCodexSkyService(options: Record<string, unknown>): Promise<Service>
  }
  const client = createCodexNativeClient({
    ...options,
    invoke: async (input, signal) => {
      if (signal?.aborted) throw new Error('CANCELLED: native call cancelled')
      return await options.invoke(input, signal)
    }
  })
  const service = await module.createCodexSkyService({
    vendorRoot: options.vendorRoot,
    nativeClient: client,
    approval: {
      beforeNativeCall: (
        context: CodexCallContext,
        policy: AppPolicy | undefined,
        method: string
      ) => {
        options.assertRunning(context.taskId)
        if (context.signal?.aborted) throw new Error('CANCELLED: native call cancelled')
        if (method === 'listApps') return
        if (!policy || policy.decision !== 'allowed')
          throw new Error('INVALID_REQUEST: native call has no allowed policy')
        options.leases.acquire(policy.target.bundleId, context)
      },
      queryPolicy: async (app: string, context: CodexCallContext): Promise<AppPolicy> => {
        options.assertRunning(context.taskId)
        if (context.signal?.aborted) throw new Error('CANCELLED: policy call cancelled')
        return appPolicySchema.parse(
          await options.invoke({ operation: 'app-policy', app }, context.signal)
        )
      },
      requestApproval: (context: CodexCallContext, policy: AppPolicy, signal?: AbortSignal) =>
        options.broker.requestApproval(context, policy, signal)
    },
    withSuspendedTimeout: (operation: () => Promise<unknown>, context: CodexCallContext) => {
      options.assertRunning(context.taskId)
      return options.withSuspendedTimeout(context.taskId, operation)
    }
  })
  return {
    releaseTurn(taskId: string) {
      options.leases.releaseTurn(taskId)
    },
    releaseSession(sessionId: string) {
      options.leases.releaseSession(sessionId)
    },
    async invoke(input: unknown, context: CodexCallContext) {
      options.assertRunning(context.taskId)
      return await service.handleRpc(input, context)
    }
  }
}
