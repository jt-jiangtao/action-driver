import type { AgentFileStore } from './agent-file-store'
import type { SkillInstaller } from './skill-installer'
import type { Json } from '@action-driver/plugin-contracts'
import { resolveWorkspaceSource } from '../execution/session-workspace'
import { createSkillRuntimeTools as createPluginTools } from '@action-driver/skills-plugin/execution'
export function createSkillRuntimeTools(options: { store: AgentFileStore; installer: SkillInstaller; loadedSkills?: { record(sessionId: string, skillId: string): void } }) {
  return createPluginTools({ ...options, installer: { installSkill: async input => JSON.parse(JSON.stringify(await options.installer.installSkill(input))) as Json }, resolveWorkspaceSource })
}
