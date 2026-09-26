import type { AgentSessionRepository, TaskProjection } from '@actiondriver/contracts'
import { createStore, type StoreApi } from 'zustand/vanilla'

export interface TaskStoreState {
  activeTask: TaskProjection | null
  open(task: TaskProjection): void
  clear(): void
}

/** `connect` starts following the repository and returns the matching disconnect. */
export type TaskStore = StoreApi<TaskStoreState> & { connect(): () => void }

/**
 * Holds the task the user is looking at. Streamed projections replace it by reference, so only
 * components that select a changed field re-render; the app shell selects the id alone.
 */
export function createTaskStore(repository: Pick<AgentSessionRepository, 'subscribe'>): TaskStore {
  const store = createStore<TaskStoreState>()((set) => ({
    activeTask: null,
    open: (task) => set({ activeTask: task }),
    clear: () => set({ activeTask: null })
  }))
  const connect = () => {
    const unsubscribe = repository.subscribe((projection) => {
      if (store.getState().activeTask?.id === projection.id)
        store.setState({ activeTask: projection })
    })
    return () => void unsubscribe()
  }
  return { ...store, connect }
}
