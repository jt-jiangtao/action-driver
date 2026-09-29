import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useStore } from 'zustand'
import type { AppServices } from './container'
import { createTaskStore, type TaskStore, type TaskStoreState } from '../stores/task-store'

const AppServicesContext = createContext<AppServices | null>(null)
const TaskStoreContext = createContext<TaskStore | null>(null)

export function AppServicesProvider({
  services,
  children
}: {
  services: AppServices
  children: ReactNode
}) {
  const [queryClient] = useState(() => new QueryClient())
  const taskStore = useMemo(
    () => createTaskStore(services.agentSessionRepository),
    [services]
  )
  useEffect(() => taskStore.connect(), [taskStore])
  return (
    <QueryClientProvider client={queryClient}>
      <AppServicesContext.Provider value={services}>
        <TaskStoreContext.Provider value={taskStore}>{children}</TaskStoreContext.Provider>
      </AppServicesContext.Provider>
    </QueryClientProvider>
  )
}

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext)
  if (!services) throw new Error('AppServicesProvider is missing')
  return services
}

/** For optional surfaces that simply render nothing when the shell has no services wired. */
export function useOptionalAppServices(): AppServices | null {
  return useContext(AppServicesContext)
}

/** The task store itself, for callbacks that read the current task when they run. */
export function useTaskStoreApi(): TaskStore {
  const store = useContext(TaskStoreContext)
  if (!store) throw new Error('AppServicesProvider is missing')
  return store
}

/** Subscribes to one slice of the task store; the component re-renders only when it changes. */
export function useTaskStore<T>(selector: (state: TaskStoreState) => T): T {
  return useStore(useTaskStoreApi(), selector)
}
