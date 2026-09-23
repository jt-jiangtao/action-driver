import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from './desktop-api'

describe('createDesktopApi', () => {
  it('exposes only environment information and the seven Agent operations', async () => {
    const invocations: Array<{ channel: string; input: unknown }> = []
    const listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>()
    const bridge = {
      invoke(channel: string, input: unknown) {
        invocations.push({ channel, input })
        if (channel === 'actiondriver:runtime-connection:get') {
          return Promise.resolve({
            wsUrl: 'ws://127.0.0.1:4321/stream',
            protocol: 'actiondriver.stream.v1',
            accessToken: 'launch-token'
          })
        }
        return Promise.resolve({
          ok: true,
          value: channel.endsWith(':subscribe') ? { cursor: 4 } : { accepted: true }
        })
      },
      on(channel: string, listener: (event: unknown, payload: unknown) => void) {
        const channelListeners = listeners.get(channel) ?? new Set()
        channelListeners.add(listener)
        listeners.set(channel, channelListeners)
      },
      off(channel: string, listener: (event: unknown, payload: unknown) => void) {
        listeners.get(channel)?.delete(listener)
      }
    }
    const api = createDesktopApi('darwin', '0.1.0', bridge, () => 'renderer-subscription')

    expect(api.getEnvironment()).toEqual({ platform: 'darwin', version: '0.1.0' })
    expect(Object.keys(api)).toEqual([
      'getEnvironment',
      'agent',
      'runtimeConnection',
      'modelConnections',
      'logs',
      'agentFiles'
    ])
    expect(Object.keys(api.agent).sort()).toEqual([
      'continue',
      'controlSkill',
      'get',
      'getModelLog',
      'interrupt',
      'listModelLogs',
      'listTasks',
      'provideInput',
      'subscribe'
    ])
    expect(api).not.toHaveProperty('ipcRenderer')
    expect(api).not.toHaveProperty('messagePort')
    expect(api).not.toHaveProperty('utilityProcess')
    expect(api).not.toHaveProperty('databasePath')
    expect(Object.keys(api.logs)).toEqual(['list', 'detail'])
    expect(Object.keys(api.agentFiles).sort()).toEqual([
      'createSkill',
      'deleteSkill',
      'getMainPrompt',
      'getSkillTree',
      'listSkills',
      'readFile',
      'renameSkill',
      'resetMainPrompt',
      'saveFile',
      'setSkillEnabled'
    ])
    expect(Object.keys(api.modelConnections).sort()).toEqual([
      'add',
      'delete',
      'discover',
      'list',
      'refresh',
      'setModelEnabled',
      'testConnection',
      'testConnectionModels',
      'testModels'
    ])

    await expect(api.runtimeConnection.get()).resolves.toEqual({
      wsUrl: 'ws://127.0.0.1:4321/stream',
      protocol: 'actiondriver.stream.v1',
      accessToken: 'launch-token'
    })
    await api.agent.get('task-1')
    await api.agent.listTasks(20)
    await api.agent.listModelLogs({ status: 'failed' })
    await api.agent.getModelLog('task-1')
    await api.agent.interrupt('task-1')
    await api.agent.continue('task-1')
    await api.agent.provideInput('task-1', 'confirm')
    await api.agent.controlSkill('browser-invocation', 'take-over')

    const events: unknown[] = []
    const unsubscribe = await api.agent.subscribe('task-1', 4, (event) => events.push(event))
    for (const listener of listeners.get('actiondriver:agent:event') ?? []) {
      listener(undefined, {
        subscriptionId: 'another-subscription',
        event: { cursor: 5, taskId: 'task-2' }
      })
      listener(undefined, {
        subscriptionId: 'renderer-subscription',
        event: { cursor: 5, taskId: 'task-1' }
      })
    }
    expect(events).toEqual([{ cursor: 5, taskId: 'task-1' }])

    unsubscribe()
    for (const listener of listeners.get('actiondriver:agent:event') ?? []) {
      listener(undefined, {
        subscriptionId: 'renderer-subscription',
        event: { cursor: 6, taskId: 'task-1' }
      })
    }
    expect(events).toEqual([{ cursor: 5, taskId: 'task-1' }])
    const draft = {
      name: '公司模型网关',
      protocol: 'openai-compatible' as const,
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-e2e-secret'
    }
    expect(invocations).toEqual([
      {
        channel: 'actiondriver:runtime-connection:get',
        input: {}
      },
      { channel: 'actiondriver:agent:get', input: { taskId: 'task-1' } },
      { channel: 'actiondriver:agent:list', input: { limit: 20 } },
      { channel: 'actiondriver:agent:model-log-list', input: { status: 'failed' } },
      { channel: 'actiondriver:agent:model-log-get', input: { taskId: 'task-1' } },
      { channel: 'actiondriver:agent:interrupt', input: { taskId: 'task-1' } },
      { channel: 'actiondriver:agent:continue', input: { taskId: 'task-1' } },
      {
        channel: 'actiondriver:agent:provide-input',
        input: { taskId: 'task-1', value: 'confirm' }
      },
      {
        channel: 'actiondriver:agent:control-skill',
        input: { invocationId: 'browser-invocation', command: 'take-over' }
      },
      {
        channel: 'actiondriver:agent:subscribe',
        input: {
          subscriptionId: 'renderer-subscription',
          taskId: 'task-1',
          afterCursor: 4
        }
      }
    ])

    await api.modelConnections.list()
    await api.modelConnections.testConnection(draft)
    await api.modelConnections.discover(draft)
    await api.modelConnections.refresh('company-gateway')
    await api.modelConnections.testModels(draft, ['qwen3.7-plus'])
    await api.modelConnections.testConnectionModels('company-gateway', ['qwen3.7-plus'])
    await api.modelConnections.setModelEnabled('company-gateway', 'qwen3.7-plus', true)
    await api.modelConnections.add(draft, [
      { id: 'qwen3.7-plus', name: 'qwen3.7-plus', enabled: true, testState: 'success' }
    ])
    await api.modelConnections.delete('company-gateway')

    expect(invocations.slice(-9)).toEqual([
      { channel: 'actiondriver:model-connections:list', input: {} },
      { channel: 'actiondriver:model-connections:test-connection', input: draft },
      { channel: 'actiondriver:model-connections:discover', input: draft },
      {
        channel: 'actiondriver:model-connections:refresh',
        input: { connectionId: 'company-gateway' }
      },
      {
        channel: 'actiondriver:model-connections:test-models',
        input: { draft, modelIds: ['qwen3.7-plus'] }
      },
      {
        channel: 'actiondriver:model-connections:test-connection-models',
        input: { connectionId: 'company-gateway', modelIds: ['qwen3.7-plus'] }
      },
      {
        channel: 'actiondriver:model-connections:set-model-enabled',
        input: { connectionId: 'company-gateway', modelId: 'qwen3.7-plus', enabled: true }
      },
      {
        channel: 'actiondriver:model-connections:add',
        input: {
          draft,
          models: [
            { id: 'qwen3.7-plus', name: 'qwen3.7-plus', enabled: true, testState: 'success' }
          ]
        }
      },
      {
        channel: 'actiondriver:model-connections:delete',
        input: { connectionId: 'company-gateway' }
      }
    ])
  })

  it('rejects with the structured Runtime error returned by Main', async () => {
    const error = {
      code: 'RUNTIME_DISCONNECTED',
      message: 'Runtime message channel disconnected'
    }
    const api = createDesktopApi('darwin', '0.1.0', {
      invoke: () => Promise.resolve({ ok: false, error }),
      on: () => undefined,
      off: () => undefined
    })

    await expect(api.agent.get('task-1')).rejects.toEqual(error)
  })

  it('uses separate summary and detail log channels', async () => {
    const invoke = vi.fn((channel: string) =>
      Promise.resolve(
        channel === 'actiondriver:logs:list'
          ? { ok: true, value: { records: [], nextCursor: null, files: [] } }
          : { ok: true, value: { id: 'service:event-1' } }
      )
    )
    const api = createDesktopApi('darwin', '0.1.0', {
      invoke,
      on: () => undefined,
      off: () => undefined
    })

    await api.logs.list({ transports: ['http'], limit: 50 })
    await api.logs.detail('service:event-1')

    expect(invoke).toHaveBeenNthCalledWith(1, 'actiondriver:logs:list', {
      transports: ['http'],
      limit: 50
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'actiondriver:logs:detail', {
      eventId: 'service:event-1'
    })
  })

  it.each([
    ['', 'pause'],
    ['browser-invocation', 'cancel']
  ])('rejects invalid Skill control input before IPC', async (invocationId, command) => {
    const invoke = vi.fn(() => Promise.resolve({ ok: true, value: {} }))
    const api = createDesktopApi('darwin', '0.1.0', {
      invoke,
      on: () => undefined,
      off: () => undefined
    })

    await expect(
      api.agent.controlSkill(invocationId, command as Parameters<typeof api.agent.controlSkill>[1])
    ).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
    expect(invoke).not.toHaveBeenCalled()
  })
})
