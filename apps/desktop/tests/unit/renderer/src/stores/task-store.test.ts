import type { TaskProjection } from '@actiondriver/contracts'
import { describe, expect, it } from 'vitest'
import { createTaskStore } from '../../../../../src/renderer/src/stores/task-store'

function repository() {
  const listeners = new Set<(task: TaskProjection) => void>()
  return {
    subscribe(listener: (task: TaskProjection) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish: (task: TaskProjection) => listeners.forEach((listener) => listener(task)),
    listenerCount: () => listeners.size
  }
}

const task = (id: string, title = id): TaskProjection => ({
  id,
  sessionId: 'session-1',
  title,
  status: 'running',
  model: { connectionId: 'connection-1', modelId: 'model-1' },
  messages: [],
  steps: [],
  browser: null
})

describe('task store', () => {
  it('starts without an active task', () => {
    expect(createTaskStore(repository()).getState().activeTask).toBeNull()
  })

  it('opens a task and clears it', () => {
    const store = createTaskStore(repository())
    const opened = task('task-1')
    store.getState().open(opened)
    expect(store.getState().activeTask).toBe(opened)
    store.getState().clear()
    expect(store.getState().activeTask).toBeNull()
  })

  it('accepts repository updates only for the active task', () => {
    const source = repository()
    const store = createTaskStore(source)
    store.connect()
    store.getState().open(task('task-1'))

    source.publish(task('task-2', 'other'))
    expect(store.getState().activeTask?.id).toBe('task-1')

    const update = task('task-1', 'updated')
    source.publish(update)
    expect(store.getState().activeTask).toBe(update)
  })

  it('ignores repository updates while no task is open', () => {
    const source = repository()
    const store = createTaskStore(source)
    store.connect()
    source.publish(task('task-1'))
    expect(store.getState().activeTask).toBeNull()
  })

  it('listens to the repository only while connected', () => {
    const source = repository()
    const store = createTaskStore(source)
    expect(source.listenerCount()).toBe(0)
    const disconnect = store.connect()
    expect(source.listenerCount()).toBe(1)
    disconnect()
    expect(source.listenerCount()).toBe(0)
  })
})
