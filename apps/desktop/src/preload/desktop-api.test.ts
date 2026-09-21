import { describe, expect, it } from 'vitest'
import { createDesktopApi } from './desktop-api'

describe('createDesktopApi', () => {
  it('exposes only environment information and the six Agent operations', async () => {
    const invocations: Array<{ channel: string; input: unknown }> = []
    const listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>()
    const bridge = {
      invoke(channel: string, input: unknown) {
        invocations.push({ channel, input })
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
    expect(Object.keys(api)).toEqual(['getEnvironment', 'agent'])
    expect(Object.keys(api.agent)).toEqual([
      'submit',
      'get',
      'interrupt',
      'continue',
      'provideInput',
      'subscribe'
    ])
    expect(api).not.toHaveProperty('ipcRenderer')
    expect(api).not.toHaveProperty('messagePort')
    expect(api).not.toHaveProperty('utilityProcess')
    expect(api).not.toHaveProperty('databasePath')

    await api.agent.submit('Book a hotel')
    await api.agent.get('task-1')
    await api.agent.interrupt('task-1')
    await api.agent.continue('task-1')
    await api.agent.provideInput('task-1', 'confirm')

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
    expect(invocations).toEqual([
      { channel: 'actiondriver:agent:submit', input: { goal: 'Book a hotel' } },
      { channel: 'actiondriver:agent:get', input: { taskId: 'task-1' } },
      { channel: 'actiondriver:agent:interrupt', input: { taskId: 'task-1' } },
      { channel: 'actiondriver:agent:continue', input: { taskId: 'task-1' } },
      {
        channel: 'actiondriver:agent:provide-input',
        input: { taskId: 'task-1', value: 'confirm' }
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

    await expect(api.agent.submit('Book a hotel')).rejects.toEqual(error)
  })
})
