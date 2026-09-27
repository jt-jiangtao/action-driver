import { PluginError, type PluginContext } from '@actiondriver/plugin-sdk'
import { definition } from './catalog.js'
import { createWebOpenTool } from './execution.js'
import type { ExtractedPage } from './extract.js'
export function activate(context: PluginContext): void {
  context.api.tools.register(definition, {
    async *execute(call, signal, _execution, invocation) {
      if (!invocation || !signal) throw new PluginError('PROTOCOL_ERROR', 'Missing invocation context')
      const tool = createWebOpenTool({ extract: async (html, url) => {
        const result = await context.api.capabilities.invoke('host.web.extract', { html, url }, invocation, signal)
        return result as unknown as ExtractedPage
      } })
      yield* tool.executor.execute(call, signal)
    }
  })
}
