import { createContext, useContext, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppServices } from './container'

const AppServicesContext = createContext<AppServices | null>(null)

export function AppServicesProvider({
  services,
  children
}: {
  services: AppServices
  children: ReactNode
}) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      <AppServicesContext.Provider value={services}>{children}</AppServicesContext.Provider>
    </QueryClientProvider>
  )
}

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext)
  if (!services) throw new Error('AppServicesProvider is missing')
  return services
}
