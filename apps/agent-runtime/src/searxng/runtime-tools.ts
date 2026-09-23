import type { RuntimeToolRegistry } from '../tool-registry'
import { createSearxngSearchTool } from './search-tool'

export function registerSearxngTool(
  runtime: { registry: RuntimeToolRegistry; grants: string[] },
  endpoint: string | undefined
): void {
  if (!endpoint?.trim()) return
  const search = createSearxngSearchTool({ endpoint: endpoint.trim() })
  runtime.registry.register(search.definition, search.executor)
  runtime.grants.push(`${search.definition.id}@${search.definition.version}`)
}

