import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ErrorCode,
  RuntimeContractFixture,
  SkillState
} from '../src/generated/actiondriver/runtime/v1/runtime'

describe('runtime v1 wire contract', () => {
  it('keeps stable wire enum numbers', () => {
    expect(ErrorCode.PROTOCOL_INCOMPATIBLE).toBe(2)
    expect(SkillState.QUEUED).toBe(1)
    expect(SkillState.FAILED).toBe(7)
  })

  it('round-trips the cross-language golden envelope', () => {
    const fixturePath = resolve(
      process.cwd(),
      'proto/actiondriver/runtime/v1/testdata/runtime-envelope.json'
    )
    const json = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown
    const decoded = RuntimeContractFixture.decode(
      RuntimeContractFixture.encode(RuntimeContractFixture.fromJSON(json)).finish()
    )

    expect(decoded.context?.requestId).toBe('req-golden-001')
    expect(decoded.handshake?.protocolMajor).toBe(1)
    expect(decoded.error?.code).toBe(ErrorCode.PROTOCOL_INCOMPATIBLE)
    expect(decoded.invocation?.state).toBe(SkillState.QUEUED)
    expect(decoded.event?.cursor).toBe('42')
  })
})
