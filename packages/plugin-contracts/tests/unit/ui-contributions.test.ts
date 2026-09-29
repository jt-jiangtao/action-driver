import { describe, expect, it } from 'vitest'
import { PLUGIN_UI_PROTOCOL_VERSION, buildContributionCatalog, validateCatalog, validateManifest } from '../../src/index'

const base = {
  id: 'fixture', version: '1.2.0', sdk: '^1.0.0', entry: 'src/index.js',
  platforms: ['darwin-arm64'],
  contributions: [
    { kind: 'command', id: 'fixture.refresh', when: 'plugin.fixture.ready && host.online' },
    { kind: 'view', id: 'fixture.dashboard', when: 'host.online' },
    { kind: 'menu', id: 'fixture.refresh-menu' }
  ],
  views: [{ id: 'fixture.dashboard', title: 'Dashboard', container: 'sidebar', entry: 'src/dashboard.html' }],
  menus: [{ id: 'fixture.refresh-menu', title: '刷新', command: 'fixture.refresh', location: 'plugins-menu' }]
}
const host = { sdk: '1.3.0', platform: 'darwin-arm64', uiProtocol: PLUGIN_UI_PROTOCOL_VERSION }

describe('declarative view and menu contributions', () => {
  it('declares views and menus with their definitions and availability conditions', () => {
    const manifest = validateManifest(base, host)
    expect(manifest.views?.[0]).toMatchObject({ id: 'fixture.dashboard', container: 'sidebar' })
    expect(manifest.menus?.[0]).toMatchObject({ command: 'fixture.refresh', location: 'plugins-menu' })
    expect(manifest.contributions.find(item => item.kind === 'view')?.when).toBe('host.online')
  })

  it('projects the full contribution catalog without activating plugin code', () => {
    const manifest = validateManifest(base, host)
    const catalog = buildContributionCatalog(manifest, validateCatalog({ tools: [], skills: [] }, manifest))
    expect(catalog.views.map(view => view.id)).toEqual(['fixture.dashboard'])
    expect(catalog.menus.map(menu => menu.command)).toEqual(['fixture.refresh'])
    expect(catalog.commands.map(command => command.id)).toEqual(['fixture.refresh'])
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog)
  })

  it('rejects a menu that references an undeclared command', () => {
    const manifest = { ...base, menus: [{ ...base.menus[0]!, command: 'fixture.missing' }] }
    expect(() => validateManifest(manifest, host)).toThrow('INVALID_MANIFEST')
    expect(() => validateManifest(manifest, host)).toThrow(/command/i)
  })

  it('rejects view and menu definitions without a matching contribution declaration', () => {
    expect(() => validateManifest({ ...base, contributions: base.contributions.filter(item => item.kind !== 'view') }, host)).toThrow(/undeclared view/i)
    expect(() => validateManifest({ ...base, contributions: base.contributions.filter(item => item.kind !== 'menu') }, host)).toThrow(/undeclared menu/i)
  })

  it('rejects duplicate view and menu contribution IDs', () => {
    expect(() => validateManifest({ ...base, contributions: [...base.contributions, { kind: 'menu', id: 'fixture.refresh-menu' }] }, host)).toThrow('CONTRIBUTION_CONFLICT')
    expect(() => validateManifest({ ...base, views: [...base.views, ...base.views] }, host)).toThrow('CONTRIBUTION_CONFLICT')
  })

  it('rejects invalid availability conditions on views and menus', () => {
    const manifest = { ...base, contributions: base.contributions.map(item => item.kind === 'view' ? { ...item, when: 'host.online &&' } : item) }
    expect(() => validateManifest(manifest, host)).toThrow('INVALID_MANIFEST')
    expect(() => validateManifest({ ...base, contributions: base.contributions.map(item => item.kind === 'menu' ? { ...item, when: 'host.online' } : item) }, host)).toThrow('INVALID_MANIFEST')
  })

  it('rejects unsupported condition kinds and view definitions that mix entry and url', () => {
    expect(() => validateManifest({ ...base, contributions: [...base.contributions, { kind: 'panel', id: 'fixture.panel', when: 'host.online' }] }, host)).toThrow('INVALID_MANIFEST')
    expect(() => validateManifest({ ...base, views: [{ ...base.views[0]!, url: 'https://example.com/view' }] }, host)).toThrow('INVALID_MANIFEST')
  })

  it('rejects plugins that require the UI protocol on a host without it', () => {
    const legacyHost = { sdk: '1.3.0', platform: 'darwin-arm64' }
    expect(() => validateManifest(base, legacyHost)).toThrow('INCOMPATIBLE')
    expect(() => validateManifest(base, legacyHost)).toThrow(new RegExp(String(PLUGIN_UI_PROTOCOL_VERSION)))
  })

  it('keeps legacy manifests valid on hosts without the UI protocol', () => {
    const legacy = { ...base, contributions: [{ kind: 'command', id: 'fixture.refresh' }], views: undefined, menus: undefined }
    expect(validateManifest(legacy, { sdk: '1.3.0', platform: 'darwin-arm64' }).id).toBe('fixture')
  })
})
