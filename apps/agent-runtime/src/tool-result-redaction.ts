import type { ToolExecutor } from '@actiondriver/runtime-contracts'

export type ToolRedaction = NonNullable<ToolExecutor['redactForPersistence']>
export type ToolJson = Parameters<ToolRedaction>[1]

/**
 * Applies a tool's persistence redaction to the collected output
 * (`{ stdout, stderr, content, result, ... }`), whose `result` holds the executor's value.
 */
export function redactCollectedOutput(redact: ToolRedaction | undefined, output: unknown): unknown {
  if (!redact || output === null || typeof output !== 'object' || !('result' in output)) {
    return output
  }
  const collected = output as { result: unknown }
  return {
    ...collected,
    result: collected.result === null ? null : redact('output', collected.result as ToolJson)
  }
}
