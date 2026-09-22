import { describe, expect, it } from 'vitest'
import { encodeInteractionPayload, sanitizeCredentialPaths } from './interaction-payload'

describe('interaction payloads', () => {
  it('removes declared credential paths but keeps ordinary business text', () => {
    const result = sanitizeCredentialPaths(
      { draft: { apiKey: 'secret', name: 'team' }, prompt: { token: 'explain this token' } },
      ['draft.apiKey']
    )
    expect(result).toEqual({ draft: { name: 'team' }, prompt: { token: 'explain this token' } })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('fails closed when a declared credential path cannot be sanitized', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => sanitizeCredentialPaths(cyclic, ['self.apiKey'])).toThrow('UNSAFE_TO_PERSIST')
  })

  it('truncates text by UTF-8 bytes and preserves the original byte count', () => {
    const payload = encodeInteractionPayload({ kind: 'text', text: '你好世界' }, 7)
    expect(payload).toMatchObject({
      kind: 'text',
      byteLength: 12,
      truncated: true,
      text: '你好'
    })
  })

  it('stores binary metadata without a body', () => {
    expect(
      encodeInteractionPayload({
        kind: 'binary-metadata',
        byteLength: 2048,
        contentType: 'image/png',
        summary: 'sha256:abc'
      })
    ).toEqual({
      kind: 'binary-metadata',
      contentType: 'image/png',
      byteLength: 2048,
      truncated: false,
      text: 'sha256:abc',
      unavailableReason: null
    })
  })
})
