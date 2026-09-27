import { readDefinition, installDefinition } from './definitions.js'
import { PluginError, type Json, type ToolCall, type ToolDefinition, type ToolExecutor } from '@actiondriver/plugin-sdk'
type ToolExecutionContext = Parameters<ToolExecutor['execute']>[2]
type Workspace = NonNullable<ToolExecutionContext>['workspace']
type InstallInput = { source: 'local'; path: string } | { source: 'github'; url: string }
export interface SkillToolPorts {
  store: { readEnabledSkillFile(id: string, path?: string): Promise<{ path: string; content: string }> }
  installer: { installSkill(input: InstallInput): Promise<Json> }
  resolveWorkspaceSource(workspace: Workspace, path: string): Promise<string>
  loadedSkills?: { record(sessionId: string, skillId: string): void }
}
type Registered = { definition: ToolDefinition; executor: ToolExecutor }

export function createSkillRuntimeTools(options: SkillToolPorts): Registered[] {
  return [
    {
      definition: readDefinition,
      executor: {
        async *execute(call: ToolCall, _signal?: AbortSignal, context?: ToolExecutionContext) {
          const skillId = call.arguments.skillId
          const path = call.arguments.path
          if (typeof skillId !== 'string' || (path !== undefined && typeof path !== 'string')) {
            throw new Error('TOOL_INPUT_INVALID')
          }
          const file = await options.store.readEnabledSkillFile(skillId, path)
          if (context?.sessionId && (path === undefined || path === 'SKILL.md')) {
            options.loadedSkills?.record(context.sessionId, skillId)
          }
          yield { kind: 'result', output: { skillId, path: file.path, content: file.content } }
        }
      }
    },
    {
      definition: installDefinition,
      executor: {
        async *execute(call: ToolCall, _signal?: AbortSignal, context?: ToolExecutionContext) {
          const { source, path, url } = call.arguments
          const input = source === 'local' && typeof path === 'string'
            ? { source: 'local' as const, path }
            : source === 'github' && typeof url === 'string'
              ? { source: 'github' as const, url }
              : null
          if (!input) throw new Error('TOOL_INPUT_INVALID')
          // A local Skill folder is only readable while it stays inside the
          // current session workspace; the desktop flow covers other folders.
          const installed = await options.installer.installSkill(
            input.source === 'local'
              ? {
                  source: 'local',
                  path: await options.resolveWorkspaceSource(
                    requireWorkspace(context),
                    input.path
                  )
                }
              : input
          )
          yield { kind: 'result', output: installed }
        }
      }
    }
  ]
}

function requireWorkspace(context: ToolExecutionContext | undefined) {
  if (!context?.workspace.root) throw new PluginError('EXECUTION_CONTEXT_UNAVAILABLE', 'no persisted task owns this execution')
  return context.workspace
}
