import { PluginError, type PluginContext, type ToolExecutorEvent } from '@actiondriver/plugin-sdk'
import { catalog } from './catalog.js'
export function activate(context: PluginContext): void {
  for (const definition of catalog.tools) context.api.tools.register(definition, {
    async *execute(call, signal, _execution, invocation) {
      if (!invocation || !signal) throw new PluginError('COMPUTER_USE_CONTEXT_REQUIRED', 'Missing authoritative task context')
      for await (const event of context.api.capabilities.stream('host.computer.execute', { toolId: definition.id, call: { callId: call.callId, providerCallId: call.providerCallId, modelName: call.modelName, arguments: call.arguments } }, invocation, signal)) yield event as ToolExecutorEvent
    }
  })
  context.api.skills.register(catalog.skills[0]!)
}
