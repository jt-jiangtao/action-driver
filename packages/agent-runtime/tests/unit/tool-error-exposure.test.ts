import { describe, expect, it } from 'vitest'
import { COMPUTER_USE_GUIDANCE_ERRORS, isExposableToolError } from '../../src/tool-error-exposure'
import { redactToolError } from '@action-driver/agent-runtime/tool-result-redaction'

describe('tool error exposure', () => {
  it('keeps every Computer Use guidance message readable through redaction', () => {
    for (const message of Object.values(COMPUTER_USE_GUIDANCE_ERRORS)) {
      expect(isExposableToolError(message)).toBe(true)
      expect(
        redactToolError({ code: 'TOOL_EXECUTION_FAILED', message, retryable: false })
      ).toEqual({ code: 'TOOL_EXECUTION_FAILED', message, retryable: false })
    }
  })

  it('redacts failures that may carry screen content, JavaScript source or user text', () => {
    const messages = [
      'INVALID_REQUEST: Expected string, received 42 at "app"',
      'private screen text',
      'nodeRepl.write("private-source-987")'
    ]
    for (const message of messages) {
      expect(isExposableToolError(message)).toBe(false)
      expect(
        redactToolError({ code: 'TOOL_EXECUTION_FAILED', message, retryable: false }).message
      ).toBe(`[redacted ${message.length} characters]`)
    }
  })
})
