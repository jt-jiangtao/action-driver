import { z } from 'zod'
import type { Json, PluginOwner } from '@actiondriver/plugin-contracts'
import type { SkillRegistry } from '../ports'
export function createDesktopResourcePort(registry: SkillRegistry, ids: () => string) {
  const execute = async (owner: PluginOwner, operation: 'bind' | 'request' | 'release', method?: string, payload?: Json): Promise<Json> => {
    const provider = registry.resolve('plugin-panels', 1)
    const result = await provider.execute({ invocationId: ids(), input: { owner, operation, ...(method ? { method } : {}), ...(payload !== undefined ? { payload } : {}) } })
    return z.json().parse(result.input)
  }
  return {
    begin: (owner: PluginOwner) => execute(owner, 'bind').then(() => {}),
    request: (owner: PluginOwner, method: string, input: Json) => execute(owner, 'request', method, input),
    end: (owner: PluginOwner) => execute(owner, 'release').then(() => {})
  }
}
