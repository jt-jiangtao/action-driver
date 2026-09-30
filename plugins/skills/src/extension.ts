import { PluginError, type PluginContext, type Json } from '@action-driver/plugin-sdk'
import { catalog } from './catalog.js'
import { createSkillRuntimeTools } from './execution.js'
export function activate(context: PluginContext): void {
  for (const skill of catalog.skills) context.api.skills.register(skill)
  for (const definition of catalog.tools) context.api.tools.register(definition, {
    async *execute(call, signal, execution, invocation) {
      if (!invocation || !signal) throw new PluginError('PROTOCOL_ERROR', 'Missing Skill invocation')
      const tools = createSkillRuntimeTools({
        store: { readEnabledSkillFile: async (skillId, path) => await context.api.capabilities.invoke('host.skills.read', { skillId, ...(path ? { path } : {}) }, invocation, signal) as { path: string; content: string } },
        installer: { installSkill: async input => await context.api.capabilities.invoke('host.skills.install', { ...input }, invocation, signal) },
        // The host resolves and validates local paths using persisted workspace authority.
        resolveWorkspaceSource: async (_workspace, path) => path
      })
      const tool = tools.find(tool => tool.definition.id === definition.id)!
      for await (const event of tool.executor.execute(call, signal, execution)) yield event as { kind: 'result'; output: Json }
    }
  })
}
