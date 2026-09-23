import { describe, expect, it } from 'vitest'
import {
  parseToolCall,
  parseToolApprovalCommand,
  parseToolDefinition,
  parseToolEvent,
  type ToolDefinition
} from '../src'

const definition: ToolDefinition = {
  id: 'sandbox.fs.read',
  version: 1,
  modelName: 'sandbox_fs_read',
  description: 'Read a UTF-8 file in the workspace',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false
  },
  risk: 'low',
  sideEffects: { filesystem: 'read', network: false },
  timeoutMs: 10_000
}

describe('tool protocol', () => {
  it('parses versioned tool definitions and calls as strict serializable contracts', () => {
    expect(parseToolDefinition(definition)).toEqual(definition)
    expect(
      parseToolCall({
        callId: 'call-1',
        providerCallId: 'provider-1',
        modelName: 'sandbox_fs_read',
        arguments: { path: 'README.md' }
      })
    ).toEqual({
      callId: 'call-1',
      providerCallId: 'provider-1',
      modelName: 'sandbox_fs_read',
      arguments: { path: 'README.md' }
    })
  })

  it('rejects unknown fields and non-JSON values', () => {
    expect(() => parseToolDefinition({ ...definition, executable: '/bin/sh' })).toThrow()
    expect(() =>
      parseToolCall({
        callId: 'call-1',
        providerCallId: 'provider-1',
        modelName: 'sandbox_fs_read',
        arguments: { callback: () => undefined }
      })
    ).toThrow()
  })

  it('parses lifecycle and content events without accepting malformed terminal payloads', () => {
    expect(
      parseToolEvent({
        type: 'tool.content',
        callId: 'call-1',
        taskId: 'task-1',
        sequence: 1,
        stream: 'stdout',
        delta: 'README'
      })
    ).toMatchObject({ type: 'tool.content', delta: 'README' })
    expect(() =>
      parseToolEvent({
        type: 'tool.completed',
        callId: 'call-1',
        taskId: 'task-1',
        sequence: 2
      })
    ).toThrow()
  })

  it('parses approval commands bound to task, call, and arguments hash', () => {
    expect(
      parseToolApprovalCommand({
        action: 'approve',
        taskId: 'task-1',
        callId: 'call-1',
        argumentsHash: 'sha256:test'
      })
    ).toEqual({
      action: 'approve',
      taskId: 'task-1',
      callId: 'call-1',
      argumentsHash: 'sha256:test'
    })
    expect(() =>
      parseToolApprovalCommand({
        action: 'approve',
        taskId: 'task-1',
        callId: 'call-1',
        argumentsHash: ''
      })
    ).toThrow()
  })
})
