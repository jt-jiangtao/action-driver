import type { ToolCall, ToolDecision, ToolDefinition } from '@actiondriver/runtime-contracts'

export type ToolPolicyContext = {
  grants: readonly string[]
}

export class RuntimeToolPolicy {
  discover(definitions: readonly ToolDefinition[], context: ToolPolicyContext): ToolDefinition[] {
    const grants = new Set(context.grants)
    return definitions
      .filter((definition) => grants.has(toolGrantKey(definition)))
      .map((definition) => structuredClone(definition))
  }

  decide(definition: ToolDefinition, call: ToolCall, context: ToolPolicyContext): ToolDecision {
    if (!context.grants.includes(toolGrantKey(definition))) {
      return {
        kind: 'deny',
        error: {
          code: 'TOOL_DENIED',
          message: `${definition.id}@${definition.version} is not granted for this run`,
          retryable: false
        }
      }
    }
    if (definition.modelName !== call.modelName) {
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
