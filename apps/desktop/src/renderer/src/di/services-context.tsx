import { createContext, useContext, type ReactNode } from 'react'
import type { AppServices } from './container'

const AppServicesContext = createContext<AppServices | null>(null)

export function AppServicesProvider({
  services,
  children
}: {
  services: AppServices
  children: ReactNode
}) {
  return <AppServicesContext.Provider value={services}>{children}</AppServicesContext.Provider>
}

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext)
  if (!services) throw new Error('AppServicesProvider is missing')
  return services
}
