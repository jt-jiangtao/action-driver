import { describe, expect, it } from 'vitest'
import {
  ResourceError,
  assertScopeAuthorized,
  formatResourceUri,
  parseResourceUri,
  resourceProviderDescriptorSchema
} from '../../src/index'

const authority = { taskId: 'task-1', sessionId: 'session-1' }
/** Reads the structured code instead of matching prose, which is what callers must rely on. */
function failureCode(run: () => unknown): string {
  try { run() } catch (error) { return error instanceof ResourceError ? error.code : `unexpected:${String(error)}` }
  return 'no-error'
}

describe('resource URI contract', () => {
  it('round-trips a canonical URI with its scope', () => {
    const uri = formatResourceUri({ scheme: 'session-input', id: 'uploads/report.pdf', scope: authority })
    expect(uri).toBe('adr://v1/session-input/uploads/report.pdf?task=task-1&session=session-1')
    expect(parseResourceUri(uri)).toEqual({ scheme: 'session-input', id: 'uploads/report.pdf', scope: authority })
    expect(formatResourceUri(parseResourceUri(uri))).toBe(uri)
  })

  it('keeps an unscoped URI scoped-free so the host can authorize it later', () => {
    const uri = formatResourceUri({ scheme: 'plugin', id: 'fixture/cache.json', scope: {} })
    expect(uri).toBe('adr://v1/plugin/fixture/cache.json')
    expect(parseResourceUri(uri).scope).toEqual({})
  })

  it('carries an optional version selector so history keeps pointing at the original copy', () => {
    const uri = formatResourceUri({ scheme: 'generated-output', id: 'a.txt', scope: { ...authority, version: '2' } })
    expect(uri).toBe('adr://v1/generated-output/a.txt?task=task-1&session=session-1&version=2')
    expect(parseResourceUri(uri).scope.version).toBe('2')
    expect(formatResourceUri(parseResourceUri(uri))).toBe(uri)
  })

  it('rejects malformed, unregistered-looking and non-canonical URIs before any provider access', () => {
    for (const value of [
      'https://example.com/file',
      'adr://v2/session-input/a',
      'adr://v1/SESSION-INPUT/a',
      'adr://user@v1/session-input/a',
      'adr://v1/session-input/a#fragment',
      'adr://v1/session-input/./a',
      'adr://v1/session-input/../a',
      'adr://v1/session-input/a%2Fb',
      'adr://v1/session-input/%2e%2e',
      'adr://v1/session-input/a%2fb',
      'adr://v1/session-input/',
      'adr://v1/session-input/a\\b',
      'adr://v1/session-input/a?task=',
      'adr://v1/session-input/a?task=t&task=u',
      'adr://v1/session-input/a?other=1'
    ]) {
      expect(() => parseResourceUri(value), value).toThrow(ResourceError)
      expect(failureCode(() => parseResourceUri(value)), value).toBe('RESOURCE_INVALID_URI')
    }
  })

  it('authorizes a reference only inside the authoritative task and session', () => {
    expect(() => assertScopeAuthorized({ scheme: 'session-input', id: 'a', scope: authority }, authority)).not.toThrow()
    expect(() => assertScopeAuthorized({ scheme: 'session-input', id: 'a', scope: {} }, authority)).not.toThrow()
    expect(failureCode(() => assertScopeAuthorized({ scheme: 'session-input', id: 'a', scope: { sessionId: 'other' } }, authority))).toBe('RESOURCE_UNAUTHORIZED')
    expect(failureCode(() => assertScopeAuthorized({ scheme: 'session-input', id: 'a', scope: { taskId: 'other' } }, authority))).toBe('RESOURCE_UNAUTHORIZED')
  })

  it('describes provider capabilities explicitly instead of implying operations', () => {
    expect(resourceProviderDescriptorSchema.parse({ scheme: 'session-input', version: 1, capabilities: { read: true, list: true } }))
      .toEqual({ scheme: 'session-input', version: 1, capabilities: { read: true, list: true, write: false, watch: false } })
    expect(() => resourceProviderDescriptorSchema.parse({ scheme: 'Session Input', version: 1, capabilities: { read: true } })).toThrow()
    expect(() => resourceProviderDescriptorSchema.parse({ scheme: 'x', version: 0, capabilities: { read: true } })).toThrow()
  })
})
