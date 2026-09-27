import { z } from 'zod'
import { PluginError, type InvocationContext, type Json } from '@actiondriver/plugin-contracts'
import type { ToolCall, ToolExecutor, ToolExecutionContext } from '@actiondriver/runtime-contracts'
export function createCommandExecutionPort(
  tools: Array<{ definition: { id: string; version: number; modelName: string }; executor: ToolExecutor }>,
  contexts: { resolve(taskId: string): Promise<ToolExecutionContext> },
  plugins = ['command']
) {
  return { plugins, grants: tools.map(tool => `${tool.definition.id}@${tool.definition.version}`),
    async *stream(input: Json, authority: InvocationContext, signal: AbortSignal): AsyncGenerator<Json> {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PluginError('TOOL_INPUT_INVALID', 'Expected command request')
      const tool = tools.find(tool => tool.definition.id === input.toolId)
      if (!tool || !authority.grants?.includes(`${tool.definition.id}@${tool.definition.version}`)) throw new PluginError('AUTHORIZATION_DENIED', 'Command tool is not granted')
      if (!authority.taskId) throw new PluginError('EXECUTION_CONTEXT_UNAVAILABLE', 'No persisted command task')
      const call = input.call
      if (!call || typeof call !== 'object' || Array.isArray(call) || call.modelName !== tool.definition.modelName || typeof call.providerCallId !== 'string' || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) throw new PluginError('TOOL_INPUT_INVALID', 'Invalid command call')
      const execution = await contexts.resolve(authority.taskId)
      if (execution.sessionId !== authority.sessionId) throw new PluginError('EXECUTION_CONTEXT_UNAVAILABLE', 'Task session changed')
      signal.throwIfAborted()
      for await (const event of tool.executor.execute({ callId: authority.callId, providerCallId: call.providerCallId, modelName: tool.definition.modelName, arguments: call.arguments } as ToolCall, signal, execution)) yield z.json().parse(event)
    }
  }
}
