import { createHash } from 'node:crypto'
import type {
  ToolCall,
  ToolDecision,
  ToolDefinition
} from '@actiondriver/runtime-contracts'

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

  decide(
    definition: ToolDefinition,
    call: ToolCall,
    context: ToolPolicyContext
  ): ToolDecision {
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
    if (
      definition.id === 'sandbox.shell.run' ||
      definition.risk !== 'low' ||
      definition.sideEffects.filesystem === 'write' ||
      definition.sideEffects.network
    ) {
      return { kind: 'require_approval', argumentsHash: hashToolArguments(call.arguments) }
    }
    return { kind: 'allow' }
  }
}

export function hashToolArguments(value: ToolCall['arguments']): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

function toolGrantKey(definition: Pick<ToolDefinition, 'id' | 'version'>): string {
  return `${definition.id}@${definition.version}`
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`
}
