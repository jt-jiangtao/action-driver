import { PluginError, type PluginContext, type ToolExecutorEvent } from '@actiondriver/plugin-sdk'
import { createCommandCatalog } from './catalog.js'
export function activate(context: PluginContext): void {
  for (const definition of createCommandCatalog().tools) {
    context.api.tools.register(definition, {
      async *execute(call, signal, _execution, invocation) {
        if (!invocation || !signal) throw new PluginError('EXECUTION_CONTEXT_UNAVAILABLE', 'Command requires an authoritative invocation')
        for await (const event of context.api.capabilities.stream('host.command.execute', { toolId: definition.id, call: { callId: call.callId, providerCallId: call.providerCallId, modelName: call.modelName, arguments: call.arguments } }, invocation, signal)) {
          yield event as ToolExecutorEvent
        }
      }
    })
  }
}
