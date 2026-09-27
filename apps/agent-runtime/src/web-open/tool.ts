import type { RuntimeToolRegistry } from '../tool-registry'
import { createWebOpenTool as createPluginTool } from '@actiondriver/web-plugin/reader'
import { extractPageTextIsolated } from './extract-isolated'
export function createWebOpenTool(options: Partial<Parameters<typeof createPluginTool>[0]> = {}) {
  return createPluginTool({ ...options, extract: options.extract ?? ((html, url, signal) => extractPageTextIsolated(html, url, signal ? { signal } : {})) })
}
export function registerWebOpenTool(runtime: { registry: RuntimeToolRegistry; grants: string[] }): void {
  const tool = createWebOpenTool()
  runtime.registry.register(tool.definition, tool.executor)
  runtime.grants.push(`${tool.definition.id}@${tool.definition.version}`)
}
