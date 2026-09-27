import { describe, expect, it } from 'vitest'
import { validateManifest, resolveDependencies, PluginError } from './index'

const manifest = (id = 'fixture') => ({ id, version: '1.2.0', sdk: '^1.0.0', entry: 'src/index.js', platforms: ['darwin-arm64'], contributions: [{ kind: 'tool', id: 'fixture.read', modelName: 'fixture_read' }], dependencies: [] })
const host = { sdk: '1.3.0', platform: 'darwin-arm64' }
describe('plugin contracts', () => {
  it('accepts compatible manifests and rejects malformed identity and entry traversal', () => {
    expect(validateManifest(manifest(), host).id).toBe('fixture')
    expect(() => validateManifest({ ...manifest(), id: '../escape' }, host)).toThrow()
    expect(() => validateManifest({ ...manifest(), entry: '../escape.js' }, host)).toThrow()
  })
  it('rejects incompatible SDK ranges and platforms', () => {
    expect(() => validateManifest(manifest(), { ...host, sdk: '2.0.0' })).toThrow('INCOMPATIBLE')
    expect(() => validateManifest(manifest(), { ...host, platform: 'linux-x64' })).toThrow('PLATFORM')
    expect(() => validateManifest({ ...manifest(), sdk: 'garbage' }, host)).toThrow()
  })
  it('rejects duplicate contribution IDs and tool model names', () => {
    expect(() => validateManifest({ ...manifest(), contributions: [...manifest().contributions, ...manifest().contributions] }, host)).toThrow('CONFLICT')
  })
  it('resolves dependencies before consumers and rejects missing or incompatible dependencies', () => {
    const dependency = validateManifest(manifest('dependency'), host)
    const consumer = validateManifest({ ...manifest('consumer'), dependencies: [{ id: 'dependency', version: '^1.0.0' }] }, host)
    expect(resolveDependencies([consumer, dependency]).map(p => p.id)).toEqual(['dependency', 'consumer'])
    expect(() => resolveDependencies([consumer])).toThrow('DEPENDENCY_MISSING')
    expect(() => resolveDependencies([{ ...consumer, dependencies: [{ id: 'dependency', version: '^2.0.0', optional: false }] }, dependency])).toThrow('DEPENDENCY_INCOMPATIBLE')
  })
  it('rejects cycles and tolerates only absent optional dependencies', () => {
    const a = validateManifest({ ...manifest('a'), dependencies: [{ id: 'b', version: '^1.0.0' }] }, host)
    const b = validateManifest({ ...manifest('b'), dependencies: [{ id: 'a', version: '^1.0.0' }] }, host)
    expect(() => resolveDependencies([a, b])).toThrow('DEPENDENCY_CYCLE')
    expect(resolveDependencies([{ ...a, dependencies: [{ id: 'missing', version: '^1.0.0', optional: true }] }])).toHaveLength(1)
  })
})
describe('independent contribution catalog', () => {
  it('validates exposed schemas against declared tools and rejects executable content', async () => {
    const { validateCatalog } = await import('./index')
    const declared = validateManifest(manifest(), host)
    const tool = { id: 'fixture.read', version: 1, modelName: 'fixture_read', description: 'Read fixture', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, risk: 'low', sideEffects: { filesystem: 'none', network: false }, timeoutMs: 1000 }
    expect(validateCatalog({ tools: [tool], skills: [] }, declared).tools[0]?.inputSchema.type).toBe('object')
    expect(() => validateCatalog({ tools: [{ ...tool, id: 'other.read' }], skills: [] }, declared)).toThrow('Undeclared')
    expect(() => validateCatalog({ tools: [tool], skills: [{ id: 'fixture.skill', name: 'Skill', description: 'Read', content: () => 'execute' }] }, declared)).toThrow()
  })
})

it('preserves remote error text without repeated prefixes so fixed guidance survives transport', () => {
  const error = PluginError.fromDTO({ code: 'TOOL_EXECUTION_FAILED', message: 'SKILL_NOT_LOADED: read the computer-use Skill with skill_read' })
  expect(error.message).toBe('SKILL_NOT_LOADED: read the computer-use Skill with skill_read')
  expect(error.code).toBe('TOOL_EXECUTION_FAILED')
})

it('preserves existing underscore tool identities while keeping package identities strict', () => {
  expect(validateManifest({ ...manifest(), contributions: [{ kind: 'tool', id: 'computer.js_reset', modelName: 'js_reset' }] }, host).contributions[0]?.id).toBe('computer.js_reset')
  expect(() => validateManifest({ ...manifest(), id: 'bad_package' }, host)).toThrow('INVALID_MANIFEST')
})
