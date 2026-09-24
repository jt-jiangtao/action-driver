import { describe, expect, it, vi } from 'vitest'
import { createRuntimeServices } from '../src/index'

describe('agent runtime composition root', () => {
  it('provides explicit injectable ports without a service locator', () => {
    const services = createRuntimeServices({ mode: 'mock' })
    expect(services.graphRunner).toBeDefined()
    expect(services.taskRepository).toBeDefined()
    expect(services.modelGateway).toBeDefined()
    expect(services.idGenerator.next('task')).toBe('task-1')
  })

  it('resolves deterministic model and mock skill adapters without network or credentials', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled'))
    const services = createRuntimeServices({ mode: 'mock' })
    const model = services.modelGateway
    const first = await model.complete({
      taskId: 'task-1',
      requestId: 'request-1',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' },
      messages: [{ role: 'user', content: '打开浏览器' }],
      skills: [{ skillId: 'browser-use', description: 'Operate a browser' }],
      parameters: { temperature: 0 }
    })
    const second = await model.complete({
      taskId: 'task-1',
      requestId: 'request-1',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' },
      messages: [{ role: 'user', content: '打开浏览器' }],
      skills: [{ skillId: 'browser-use', description: 'Operate a browser' }],
      parameters: { temperature: 0 }
    })

    expect(second).toEqual(first)
    expect(first).toEqual({
      kind: 'invoke-skill',
      skillId: 'browser-use',
      input: { goal: '打开浏览器' }
    })

    const registry = services.skillRegistry
    const provider = registry.resolve('browser-use', 1)
    await expect(
      provider.execute({ invocationId: 'invocation-1', input: { url: 'https://example.com' } })
    ).resolves.toEqual({
      ok: true,
      providerId: 'mock.browser',
      input: { url: 'https://example.com' }
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('provides deterministic infrastructure helpers in mock mode', () => {
    const services = createRuntimeServices({ mode: 'mock' })
    const clock = services.clock
    const ids = services.idGenerator

    expect(clock.now()).toBe('2026-01-01T00:00:00.000Z')
    expect(ids.next('task')).toBe('task-1')
    expect(ids.next('task')).toBe('task-2')
  })

  it('never silently falls back to mock adapters in local mode', () => {
    expect(() => createRuntimeServices({ mode: 'local' })).toThrow(
      'Local runtime adapters are required'
    )
  })
})
