import { describe, expect, it } from 'vitest'
import { evaluateContextCondition, parseContextCondition, validateManifest } from '../../src/index'

const host = { sdk: '1.0.0', platform: 'darwin-arm64' }
const manifest = (when?: string) => ({
  id: 'fixture', version: '1.0.0', sdk: '^1.0.0', entry: 'extension.js', platforms: ['darwin-arm64'],
  contributions: [{ kind: 'command', id: 'fixture.run', ...(when === undefined ? {} : { when }) }]
})

describe('declarative context conditions', () => {
  it('keeps legacy contributions and validates optional conditions before publication', () => {
    expect(validateManifest(manifest(), host).contributions[0]?.when).toBeUndefined()
    expect(validateManifest(manifest('plugin.fixture.ready && host.online'), host).contributions[0]?.when).toBe('plugin.fixture.ready && host.online')
    expect(() => validateManifest(manifest('plugin.fixture.ready &&'), host)).toThrow('INVALID_MANIFEST')
    expect(() => validateManifest({ ...manifest(), contributions: [{ kind: 'skill', id: 'fixture.skill', when: 'host.online' }] }, host)).toThrow('INVALID_MANIFEST')
  })

  it('evaluates precedence and equality against one snapshot', () => {
    const condition = parseContextCondition("plugin.fixture.ready || host.mode == 'active' && !host.busy")
    expect(evaluateContextCondition(condition, { 'plugin.fixture.ready': false, 'host.mode': 'active', 'host.busy': false })).toBe(true)
    expect(evaluateContextCondition(condition, { 'plugin.fixture.ready': false, 'host.mode': 'active', 'host.busy': true })).toBe(false)
    expect(evaluateContextCondition(parseContextCondition('host.count == 2 && host.online == true'), { 'host.count': 2, 'host.online': true })).toBe(true)
  })

  it('fails closed for missing keys even under negation and short circuit', () => {
    expect(evaluateContextCondition(parseContextCondition('!plugin.fixture.missing'), {})).toBe(false)
    expect(evaluateContextCondition(parseContextCondition('host.online || plugin.fixture.missing'), { 'host.online': true })).toBe(false)
  })

  it('rejects malformed and oversized conditions', () => {
    expect(() => parseContextCondition('host.online &&')).toThrow()
    expect(() => parseContextCondition('host.online; process.exit(1)')).toThrow()
    expect(() => parseContextCondition('a'.repeat(1025))).toThrow()
    expect(() => parseContextCondition('('.repeat(33) + 'host.online' + ')'.repeat(33))).toThrow()
    expect(() => parseContextCondition(Array.from({ length: 65 }, (_, index) => `host.key${index}`).join(' || '))).toThrow('64 keys')
  })
})
