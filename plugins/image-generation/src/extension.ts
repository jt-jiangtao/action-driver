import { PluginError, type PluginContext, type ImageAssetRef } from '@action-driver/plugin-sdk'
import { definition, catalog } from './catalog.js'
import { createImageGenerationTool, type ModelRef } from './execution.js'
export function activate(context: PluginContext): void {
  for (const skill of catalog.skills) context.api.skills.register(skill)
  context.api.tools.register(definition, {
    async *execute(call, signal, _execution, invocation) {
      if (!invocation || !signal) throw new PluginError('PROTOCOL_ERROR', 'Missing image invocation')
      const tool = createImageGenerationTool({
        sessionForTask: async taskId => taskId === invocation.taskId ? invocation.sessionId ?? null : null,
        defaultModel: async () => await context.api.capabilities.invoke('host.image.model', null, invocation, signal) as ModelRef | null,
        generateAsset: async ({ model, prompt }) => await context.api.capabilities.invoke('host.image.generate', { model: { ...model }, prompt }, invocation, signal) as unknown as ImageAssetRef
      })
      yield* tool.executor.execute(call, signal)
    }
  })
}
