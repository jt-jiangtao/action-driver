import { z } from 'zod'
import { PluginError, type InvocationContext, type Json } from '@actiondriver/plugin-contracts'
import type { AgentFileStore } from '../agent-files/agent-file-store'
import type { SkillInstaller } from '../agent-files/skill-installer'
import type { SessionExecutionContextResolver } from '../execution/session-execution-context'
import { resolveWorkspaceSource } from '../execution/session-workspace'
export function createSkillStoragePorts(options: { store: Pick<AgentFileStore, 'readEnabledSkillFile'>; installer: Pick<SkillInstaller, 'installSkill'>; contexts: Pick<SessionExecutionContextResolver, 'resolve'>; record(sessionId: string, skillId: string): void }) {
  const authority = async (context: InvocationContext) => {
    if (!context.taskId) throw new PluginError('EXECUTION_CONTEXT_UNAVAILABLE', 'Missing persisted task')
    const execution = await options.contexts.resolve(context.taskId)
    if (execution.sessionId !== context.sessionId) throw new PluginError('AUTHORIZATION_DENIED', 'Skill session mismatch')
    return execution
  }
  return {
    'host.skills.read': { plugins: ['skills'], grants: ['tools/local/skills/read@1'], async invoke(payload: Json, context: InvocationContext, signal: AbortSignal): Promise<Json> {
      const input = z.object({ skillId: z.string().min(1), path: z.string().min(1).optional() }).strict().parse(payload)
      const execution = await authority(context)
      signal.throwIfAborted()
      const file = await options.store.readEnabledSkillFile(input.skillId, input.path)
      if (input.path === undefined || input.path === 'SKILL.md') options.record(execution.sessionId, input.skillId)
      return { path: file.path, content: file.content }
    } },
    'host.skills.install': { plugins: ['skills'], grants: ['tools/local/skills/install@1'], async invoke(payload: Json, context: InvocationContext, signal: AbortSignal): Promise<Json> {
      const input = z.discriminatedUnion('source', [z.object({ source: z.literal('local'), path: z.string().min(1) }).strict(), z.object({ source: z.literal('github'), url: z.string().min(1) }).strict()]).parse(payload)
      const execution = await authority(context)
      signal.throwIfAborted()
      const result = await options.installer.installSkill(input.source === 'local' ? { source: 'local', path: await resolveWorkspaceSource(execution.workspace, input.path) } : input)
      return JSON.parse(JSON.stringify(result)) as Json
    } }
  }
}
