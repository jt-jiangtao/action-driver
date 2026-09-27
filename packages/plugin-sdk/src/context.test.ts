import { describe, expect, it } from 'vitest'
import { createPluginContext, ResourceLedger } from './context'
import type { HostTransport, RegistrationPort, ToolRegistrationPort } from './index'
const owner = { pluginId: 'fixture', version: '1.0.0', hostEpoch: 'epoch' }
describe('injected public SDK', () => {
  it('binds storage and host calls to the injected transport without internal services', async () => {
    const calls: { method: string; payload: unknown }[] = []
    const transport: HostTransport = { async request(method, payload) { calls.push({ method, payload }); return { stored: true } } }
    const registrations: RegistrationPort = { register() { return { dispose() {} } } }
    const tools: ToolRegistrationPort = { register() { return { dispose() {} } } }
    const context = createPluginContext(owner, { transport, registrations, tools })
    expect(await context.api.storage.get('setting')).toEqual({ stored: true })
    expect(calls).toEqual([{ method: 'storage.get', payload: { key: 'setting' } }])
    expect(context.plugin).toEqual(owner)
    expect(Object.keys(context.api)).not.toContain('database')
  })
  it('disposes all owned resources even when a disposer fails and rejects new resources after closure', async () => {
    const ledger = new ResourceLedger()
    let closed = 0
    ledger.add({ dispose() { closed++ } })
    ledger.add({ dispose() { throw new Error('broken') } })
    await expect(ledger.dispose()).rejects.toThrow('Resource cleanup')
    expect(closed).toBe(1)
    expect(() => ledger.add({ dispose() {} })).toThrow('closed')
    await ledger.dispose()
  })
})
it('exposes scoped namespaces and tracks remote leases through the same resource ledger', async () => {
  const calls: string[] = [], declarations: string[] = []
  const context = createPluginContext(owner, { tools: { register() { return { dispose() {} } } }, registrations: { register(contribution) { declarations.push(`${contribution.kind}:${contribution.id}`); return { dispose() { declarations.splice(declarations.indexOf(`${contribution.kind}:${contribution.id}`), 1) } } } }, transport: { async request(method) { calls.push(method); return { resourceId: 'lease' } }, subscribe() { return { dispose() {} } } } })
  context.api.skills.register({ id: 'fixture.instructions', name: 'Fixture', description: 'Instructions', content: 'Use fixture.echo', resources: [] })
  context.api.commands.register('fixture.command', async input => input)
  context.api.capabilities.register('fixture.echo', async input => input)
  const invocation = { requestId: 'r', callId: 'c', deadline: 100, source: { kind: 'runtime' as const }, chain: [] }
  await context.api.sessions.getContext(invocation)
  await context.api.credentials.request({ id: 'provider', purpose: 'search' }, invocation)
  await context.api.services.start('fixture.service')
  await context.api.panels.open('fixture.panel')
  await context.api.events.subscribe('plugin.changed', async () => {})
  expect(declarations).toEqual(['skill:fixture.instructions', 'command:fixture.command', 'capability:fixture.echo'])
  await context.subscriptions.dispose()
  expect(declarations).toEqual([])
  expect(calls.slice(0, 5)).toEqual(['sessions.getContext', 'credentials.request', 'services.start', 'panels.open', 'events.subscribe'])
  expect(calls.slice(5).sort()).toEqual(['events.unsubscribe', 'panels.close', 'services.stop'])
})
it('streams capability progress through an explicit transport without collecting it into a final result', async () => {
  const context = createPluginContext(owner, { registrations: { register() { return { dispose() {} } } }, tools: { register() { return { dispose() {} } } }, transport: { async request() { throw new Error('unexpected') }, async *stream() { yield { kind: 'content', delta: 'first' }; yield { kind: 'result', output: 'last' } } } })
  const stream = context.api.capabilities.stream('host.command.execute', {}, { requestId: 'r', callId: 'c', deadline: 100, source: { kind: 'runtime' }, chain: [] }, new AbortController().signal)
  expect(await stream.next()).toEqual({ value: { kind: 'content', delta: 'first' }, done: false })
  expect(await stream.next()).toEqual({ value: { kind: 'result', output: 'last' }, done: false })
})
