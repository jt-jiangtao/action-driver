import type { AgentSkillSummary } from '../../models/agent-files'

export function skillSourceLabel(source: AgentSkillSummary['source']): string {
  return source === 'plugin'
    ? '插件'
    : source === 'builtin'
      ? '系统'
      : source === 'github'
        ? 'GitHub'
        : '个人'
}
