import { AppApprovalBroker, appPolicySchema, type AppApprovalOptions } from './app-approval-broker'
import type { ComputerUseControlGate } from './control-gate'
import { createCuaEntryTools } from './cua-tools'
import type { LoadedSkills } from './skill-gate'
import type { VolatileComputerImages } from './volatile-images'

/**
 * Assembles Computer Use for the runtime: the Codex `js` / `js_reset` tools over the trusted CUA
 * runtime, sharing one app approval broker with the stream service and the HTTP decision route.
 */
export async function createComputerUseEntry(options: {
  runtimeDist: string
  vendorRoot: string
  invoke(input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  control: ComputerUseControlGate
  /** Interrupts the running turn when the user ends Computer Use with Esc (2.11). */
  stopTask?(taskId: string): void
  skills: LoadedSkills
  images: VolatileComputerImages
  approvals: Pick<AppApprovalOptions, 'isAlwaysAllowed' | 'persistAlwaysAllowed' | 'emit'>
}) {
  // The broker is created first and needs the tools only when an approval waits.
  const ready: { cua?: Awaited<ReturnType<typeof createCuaEntryTools>> } = {}
  const approvals = new AppApprovalBroker({
    ...options.approvals,
    queryPolicy: async (app) =>
      appPolicySchema.parse(await options.invoke({ operation: 'app-policy', app })),
    withSuspendedTimeout: async (taskId, wait) => {
      if (!ready.cua) throw new Error('ENGINE_UNAVAILABLE: Computer Use is not ready')
      await ready.cua.withSuspendedTimeout(taskId, wait)
    }
  })
  const cua = await createCuaEntryTools({
    runtimeDist: options.runtimeDist,
    vendorRoot: options.vendorRoot,
    broker: approvals,
    invoke: options.invoke,
    assertRunning: (taskId) => options.control.assertRunning(taskId),
    ...(options.stopTask === undefined ? {} : { stopTask: options.stopTask }),
    clearSkill: (sessionId) => options.skills.clear(sessionId),
    clearImages: (sessionId) => options.images.clearSession(sessionId),
    skillLoaded: (sessionId) => options.skills.has(sessionId, 'computer-use'),
    saveImage: async (sessionId, bytes, mimeType) => options.images.put(sessionId, bytes, mimeType)
  })
  ready.cua = cua
  return {
    tools: cua.tools,
    approvals,
    endTurn: (taskId: string) => cua.endTurn(taskId),
    dispose: () => cua.dispose()
  }
}
