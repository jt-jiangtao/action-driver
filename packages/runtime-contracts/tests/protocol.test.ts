import { isSerializableContract } from '@actiondriver/contracts'
import { describe, expect, it } from 'vitest'
import { parseRuntimeEnvelope, RUNTIME_PROTOCOL_VERSION } from '../src'

const fixtures = [
  {
    type: 'handshake.request',
    requestId: 'request-handshake',
    version: RUNTIME_PROTOCOL_VERSION,
    payload: { appVersion: '0.1.0', capabilities: ['events.v1'] }
  },
  {
    type: 'command.request',
    requestId: 'request-command',
    version: RUNTIME_PROTOCOL_VERSION,
    deadlineUnixMs: 1_800_000_000_000,
    payload: { command: 'task.submit', input: { goal: '打开示例页面' } }
  },
  {
    type: 'command.response',
    requestId: 'request-command',
    version: RUNTIME_PROTOCOL_VERSION,
    payload: { ok: true, value: { taskId: 'task-1' } }
  },
  {
    type: 'event.item',
    requestId: 'subscription-1',
    version: RUNTIME_PROTOCOL_VERSION,
    payload: { cursor: 1, event: { type: 'task.created', taskId: 'task-1' } }
  },
  {
    type: 'skill.execute',
    requestId: 'request-skill',
    version: RUNTIME_PROTOCOL_VERSION,
    deadlineUnixMs: 1_800_000_000_000,
    payload: {
      invocationId: 'invocation-1',
      requestedSkillId: 'browser-use',
      resolvedProviderId: 'browser-use.mock',
      providerVersion: '1.0.0',
      input: { action: 'open-url', url: 'https://example.com' }
    }
  }
] as const

describe('runtime protocol', () => {
  it('accepts a compatible handshake', () => {
    expect(parseRuntimeEnvelope(fixtures[0]).type).toBe('handshake.request')
  })

  it.each([
    {
      type: 'unknown',
      requestId: 'request-1',
      version: RUNTIME_PROTOCOL_VERSION,
      payload: {}
    },
    {
      type: 'command.request',
      requestId: '',
      version: RUNTIME_PROTOCOL_VERSION,
      deadlineUnixMs: 1_800_000_000_000,
      payload: { command: 'task.submit', input: {} }
    },
    {
      type: 'command.request',
      requestId: 'request-1',
      version: { major: 2, minor: 0 },
      deadlineUnixMs: 1_800_000_000_000,
      payload: { command: 'task.submit', input: {} }
    }
  ])('rejects malformed or incompatible envelopes', (value) => {
    expect(() => parseRuntimeEnvelope(value)).toThrow()
  })

  it.each(fixtures)('keeps $type structured-clone safe', (fixture) => {
    const parsed = parseRuntimeEnvelope(fixture)

    expect(structuredClone(parsed)).toEqual(parsed)
    expect(isSerializableContract(parsed)).toBe(true)
  })
})
