import { describe, expect, it, vi } from 'vitest'
import { PluginContextKeys } from '../../../src/plugins/context-keys'

const owner = { pluginId: 'fixture', version: '1.0.0', hostEpoch: 'one' }

describe('plugin context keys', () => {
  it('publishes immutable versioned snapshots when a value changes', () => {
    const keys = new PluginContextKeys()
    const listener = vi.fn()
    keys.subscribe(listener)
    const before = keys.snapshot()
    keys.setHost('host.online', true)
    expect(keys.snapshot()).toEqual({ version: 1, values: { 'host.online': true } })
    expect(before).toEqual({ version: 0, values: {} })
    keys.setHost('host.online', true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('rejects foreign keys and stale plugin instances', () => {
    const keys = new PluginContextKeys()
    keys.begin(owner)
    expect(() => keys.setPlugin(owner, 'host.online', true)).toThrow()
    expect(() => keys.setPlugin(owner, 'plugin.other.ready', true)).toThrow()
    expect(() => keys.setPlugin(owner, 'plugin.fixture.nested.ready', true)).toThrow()
    keys.setPlugin(owner, 'plugin.fixture.ready', true)
    keys.end(owner)
    expect(keys.snapshot().values).toEqual({})
    expect(() => keys.setPlugin(owner, 'plugin.fixture.ready', false)).toThrow('STALE_INSTANCE')
  })

  it('keeps dotted plugin identities from claiming another plugin namespace', () => {
    const keys = new PluginContextKeys()
    const short = { ...owner, pluginId: 'example' }
    const dotted = { ...owner, pluginId: 'example.tools' }
    keys.begin(short); keys.begin(dotted)
    expect(() => keys.setPlugin(short, 'plugin.example.tools.ready', true)).toThrow()
    keys.setPlugin(dotted, 'plugin.example.tools.ready', true)
    keys.end(short)
    expect(keys.snapshot().values['plugin.example.tools.ready']).toBe(true)
  })

  it('does not allow an old epoch to erase a replacement instance', () => {
    const keys = new PluginContextKeys()
    keys.begin(owner)
    keys.setPlugin(owner, 'plugin.fixture.ready', true)
    const replacement = { ...owner, hostEpoch: 'two' }
    keys.begin(replacement)
    keys.setPlugin(replacement, 'plugin.fixture.ready', false)
    keys.end(owner)
    expect(keys.snapshot().values['plugin.fixture.ready']).toBe(false)
  })

  it('exposes one condition evaluator for future menu and view projections', () => {
    const keys = new PluginContextKeys()
    expect(keys.evaluate('host.online')).toBe(false)
    keys.setHost('host.online', true)
    expect(keys.evaluate('host.online')).toBe(true)
    expect(keys.evaluate('host.online && !plugin.fixture.missing')).toBe(false)
  })
})
