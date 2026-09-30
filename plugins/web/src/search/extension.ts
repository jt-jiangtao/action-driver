import { PluginError, type PluginContext } from '@action-driver/plugin-sdk'
import { createTavilySearchTool } from './tavily.js'
import { createSearchDefinition } from './catalog.js'
export async function activate(context: PluginContext): Promise<void> {
  const configuration = await context.api.storage.get('configuration')
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) return
  if (configuration.searchConfigured !== true) return
  context.api.tools.register(createSearchDefinition(), {
    async *execute(call, signal, execution, invocation) {
      if (!invocation || !signal) throw new PluginError('PROTOCOL_ERROR', 'Missing invocation context')
      const apiKey = await context.api.credentials.request({ id: 'tavily', purpose: 'web.search' }, invocation)
      if (typeof apiKey !== 'string' || !apiKey.trim()) throw new PluginError('UNAVAILABLE', 'Tavily credential is not configured')
      yield* createTavilySearchTool({ apiKey }).executor.execute(call, signal, execution, invocation)
    }
  })
}
