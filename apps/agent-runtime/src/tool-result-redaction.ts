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
  const collected = output as {
    result: unknown
    stdout?: unknown
    stderr?: unknown
    content?: unknown
  }
  return {
    ...collected,
    ...Object.fromEntries(
      ['stdout', 'stderr', 'content'].flatMap((key) => {
        const text = (collected as Record<string, unknown>)[key]
        return typeof text === 'string'
          ? [
              [key, ''],
              [`${key}Length`, text.length]
            ]
          : []
      })
    ),
    result: collected.result === null ? null : redact('output', collected.result as ToolJson)
  }
}

/** Private tool failures can echo screen contents or code; keep diagnostics in live memory only. */
export function redactToolError<T>(error: T): T {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return { ...error, message: `[redacted ${error.message.length} characters]` }
  return error
}
