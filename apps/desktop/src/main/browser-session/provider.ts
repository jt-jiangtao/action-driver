import type { createTaskBrowserBinding } from './task-binding.js'
import type { HostedSkillProvider } from '../skill-provider-host.js'
import { parseBrowserSessionRequest } from './ipc.js'
import { createTaskBrowserRpc } from './cua-rpc.js'

type Binding = ReturnType<typeof createTaskBrowserBinding>

/** The task ID is injected by Runtime authority, never taken from model arguments. */
export function createBrowserUseProvider(binding: Binding | (() => Binding | null),
  emit: (taskId: string, snapshot: Awaited<ReturnType<Binding['snapshot']>>) => void = () => {}): HostedSkillProvider {
  return {
    skillId: 'browser-use', providerId: 'native.browser-use', providerVersion: '1.0.0',
    async execute(input: unknown): Promise<unknown> {
      const current = typeof binding === 'function' ? binding() : binding
      if (!current) throw new Error('BROWSER_SESSION_UNAVAILABLE')
      if (input && typeof input === 'object' && !Array.isArray(input) &&
          (input as Record<string, unknown>).action === 'rpc') {
        const request = input as Record<string, unknown>
        if (typeof request.taskId !== 'string' || !request.taskId ||
            !request.command || typeof request.command !== 'object' ||
            Array.isArray(request.command)) throw new Error('BROWSER_RPC_INVALID')
        const result = await createTaskBrowserRpc(current)(request.taskId,
          request.command as Record<string, unknown>)
        const snapshot = await current.snapshot(request.taskId)
        if (snapshot || (request.command as Record<string, unknown>).type === 'close_task')
          emit(request.taskId, snapshot)
        return result
      }
      const request = parseBrowserSessionRequest(input)
      switch (request.action) {
        case 'open': {
          const snapshot = await current.open(request.taskId, request.surface)
          emit(request.taskId, snapshot)
          return snapshot
        }
        case 'snapshot': return current.snapshot(request.taskId)
        case 'close':
          await current.close(request.taskId, request.sessionId)
          emit(request.taskId, null)
          return { closed: true }
        case 'transition': throw new Error('BROWSER_AGENT_CONTROL_UNAVAILABLE')
        case 'execute': {
          const result = await current.execute(request.taskId, request.sessionId, request.tabId,
            request.command, 'agent')
          const snapshot = await current.snapshot(request.taskId)
          emit(request.taskId, snapshot)
          if (request.command.type === 'screenshot' && result && typeof result === 'object' &&
              'bytes' in result && result.bytes instanceof Uint8Array)
            return { snapshot, screenshot: { mimeType: 'image/png',
              base64: Buffer.from(result.bytes).toString('base64') } }
          return { snapshot, result: result ?? null }
        }
      }
    }
  }
}
