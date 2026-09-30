import { PluginError, type PluginContext } from '@action-driver/plugin-sdk'
import { definition } from './catalog.js'
import { createJinaReaderTool } from './jina.js'
export async function activate(context: PluginContext): Promise<void> {
  const configuration = await context.api.storage.get('configuration')
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration) || configuration.readerConfigured !== true) return
  context.api.tools.register(definition, {
    async *execute(call, signal, _execution, invocation) {
      if (!invocation || !signal) throw new PluginError('PROTOCOL_ERROR', 'Missing invocation context')
      const apiKey = await context.api.credentials.request({ id: 'jina', purpose: 'web.open' }, invocation)
      if (typeof apiKey !== 'string' || !apiKey.trim()) throw new PluginError('UNAVAILABLE', 'Jina credential is not configured')
      const tool = createJinaReaderTool({ apiKey })
      yield* tool.executor.execute(call, signal)
    }
  })
}
