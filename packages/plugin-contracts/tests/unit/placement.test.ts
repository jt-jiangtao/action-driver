import { describe, expect, it } from 'vitest'
import { placementDeclarationSchema, supportsLocation, validateManifest } from '../../src/index'

const host = { sdk: '1.3.0', platform: 'darwin-arm64' }
const base = (placement?: unknown) => ({
  id: 'fixture',
  version: '1.2.0',
  sdk: '^1.0.0',
  entry: 'src/index.js',
  platforms: ['darwin-arm64'],
  contributions: [],
  dependencies: [],
  ...(placement === undefined ? {} : { placement })
})

describe('capability placement declaration', () => {
  it('accepts a declaration and defaults protocol and workspace', () => {
    const declared = placementDeclarationSchema.parse({ locations: ['local-workspace', 'cloud'], devices: ['filesystem'] })
    expect(declared.protocol).toBe(1)
    expect(declared.workspace).toBe('none')
    expect(supportsLocation(declared, 'cloud')).toBe(true)
    expect(supportsLocation(declared, 'ui')).toBe(false)
  })

  it('rejects an empty location list, an unknown location and a preferred location outside the list', () => {
    expect(placementDeclarationSchema.safeParse({ locations: [] }).success).toBe(false)
    expect(placementDeclarationSchema.safeParse({ locations: ['browser'] }).success).toBe(false)
    expect(placementDeclarationSchema.safeParse({ locations: ['ui'], preferred: 'cloud' }).success).toBe(false)
    expect(placementDeclarationSchema.safeParse({ locations: ['ui', 'cloud'], preferred: 'cloud' }).success).toBe(true)
  })

  it('keeps legacy manifests without a placement declaration compatible and treats them as unrestricted', () => {
    const legacy = validateManifest(base(), host)
    expect(legacy.placement).toBeUndefined()
    expect(supportsLocation(legacy.placement, 'cloud')).toBe(true)

    const declared = validateManifest(base({ locations: ['ui'], devices: ['display'] }), host)
    expect(declared.placement?.devices).toEqual(['display'])
    expect(supportsLocation(declared.placement, 'local-workspace')).toBe(false)
  })

  it('rejects a malformed placement declaration instead of silently dropping the requirement', () => {
    expect(() => validateManifest(base({ locations: ['ui'], devices: ['camera'] }), host)).toThrow(/INVALID_MANIFEST/)
    expect(() => validateManifest(base({ locations: ['ui'], protocol: 0 }), host)).toThrow(/INVALID_MANIFEST/)
  })
})
