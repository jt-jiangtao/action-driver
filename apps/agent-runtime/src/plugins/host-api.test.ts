import { describe, expect, it } from 'vitest'
import { PluginHostAPI } from './host-api'
import type { Json } from '@actiondriver/plugin-contracts'
const owner = { pluginId: 'fixture', version: '1.0.0', hostEpoch: 'epoch' }
describe('scoped host API', () => {
  it('scopes storage and logs to the validated instance and rejects unknown methods', async () => {
    const values = new Map<string, Json>(), logs: unknown[] = []
    const api = new PluginHostAPI({ assertInstance() {}, authority() { throw new Error('not in invocation') }, storage: { async get(id, key) { return values.get(`${id}:${key}`) ?? null }, async set(id, key, value) { values.set(`${id}:${key}`, value) } }, logging: { write(entry) { logs.push(entry) } } })
    await api.request(owner, 'storage.set', { key: '../settings', value: { enabled: true } })
    expect(await api.request(owner, 'storage.get', { key: '../settings' })).toEqual({ enabled: true })
    expect(await api.request({ ...owner, pluginId: 'other' }, 'storage.get', { key: '../settings' })).toBeNull()
    await api.request(owner, 'logging.write', { level: 'info', message: 'message', fields: { token: 'secret', callId: 'c' } })
    expect(logs).toEqual([{ ...owner, level: 'info', message: 'message', fields: { token: '[redacted]', callId: 'c' } }])
    await expect(api.request(owner, 'runtime.writeTask', {})).rejects.toThrow('PROTOCOL_ERROR')
  })
  it('uses authoritative invocation context for sessions, artifacts and credentials', async () => {
    const authoritative = { requestId: 'r', callId: 'c', taskId: 'persisted-task', sessionId: 'session', deadline: 100, source: { kind: 'runtime' as const }, chain: [] }
    const api = new PluginHostAPI({ assertInstance() {}, authority() { return { context: authoritative, signal: new AbortController().signal } }, sessions: { async getContext(_owner, invocation) { return { taskId: invocation.taskId! } } }, credentials: { async request(_owner, _input, invocation) { return { taskId: invocation.taskId! } } }, artifacts: { async create(_owner, _input, invocation) { return { session: invocation.sessionId! } }, async read() { return null } } })
    const forged = { ...authoritative, taskId: 'forged-task', sessionId: 'forged-session' }
    expect(await api.request(owner, 'sessions.getContext', {}, forged)).toEqual({ taskId: 'persisted-task' })
    expect(await api.request(owner, 'credentials.request', { id: 'provider', purpose: 'generation' }, forged)).toEqual({ taskId: 'persisted-task' })
    expect(await api.request(owner, 'artifacts.create', { name: 'output' }, forged)).toEqual({ session: 'session' })
    await expect(api.request(owner, 'services.start', { id: 'undeclared' })).rejects.toThrow('UNAVAILABLE')
  })
})
