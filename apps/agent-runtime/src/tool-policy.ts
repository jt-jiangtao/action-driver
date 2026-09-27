import { canonicalToolId, canonicalModelName } from '@actiondriver/plugin-contracts'
import type { ToolCall, ToolDecision, ToolDefinition } from '@actiondriver/runtime-contracts'

export type ToolPolicyContext = {
  grants: readonly string[]
}

export class RuntimeToolPolicy {
  discover(definitions: readonly ToolDefinition[], context: ToolPolicyContext): ToolDefinition[] {
    const grants = new Set(context.grants.map(canonicalToolId))
    return definitions
      .filter((definition) => grants.has(canonicalToolId(toolGrantKey(definition))))
      .map((definition) => structuredClone(definition))
  }

  decide(definition: ToolDefinition, call: ToolCall, context: ToolPolicyContext): ToolDecision {
    if (!context.grants.map(canonicalToolId).includes(canonicalToolId(toolGrantKey(definition)))) {
      return {
        kind: 'deny',
        error: {
          code: 'TOOL_DENIED',
          message: `${definition.id}@${definition.version} is not granted for this run`,
          retryable: false
        }
      }
    }
    if (canonicalModelName(definition.modelName) !== canonicalModelName(call.modelName)) {
      return {
        kind: 'deny',
        error: {
          code: 'TOOL_DEFINITION_MISMATCH',
          message: `${call.modelName} does not match ${definition.modelName}`,
          retryable: false
        }
      }
    }
    return { kind: 'allow' }
  }
}

function toolGrantKey(definition: Pick<ToolDefinition, 'id' | 'version'>): string {
  return `${definition.id}@${definition.version}`
}
