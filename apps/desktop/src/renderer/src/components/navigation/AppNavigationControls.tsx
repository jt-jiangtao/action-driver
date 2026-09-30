import { createContext, useContext, type ReactNode } from 'react'
import { IconButton } from '../ui/IconButton'

type AppNavigation = {
  canGoBack: boolean
  canGoForward: boolean
  goBack(): void
  goForward(): void
}

const AppNavigationContext = createContext<AppNavigation | null>(null)

export function AppNavigationProvider({
  value,
  children
}: {
  value: AppNavigation
  children: ReactNode
}) {
  return <AppNavigationContext.Provider value={value}>{children}</AppNavigationContext.Provider>
}

export function AppNavigationControls({
  sidebar,
  beforeNavigate
}: {
  sidebar?: { collapsed: boolean; onToggle(): void }
  beforeNavigate?: ((navigate: () => void) => void) | undefined
}) {
  const navigation = useContext(AppNavigationContext)
  if (!navigation) return null
  const navigate = (action: () => void) => (beforeNavigate ? beforeNavigate(action) : action())
  return (
    <div className="app-window-controls">
      <IconButton
        icon="arrow-left"
        aria-label="应用后退"
        testId="e2e/shared/navigation/back#button"
        disabled={!navigation.canGoBack}
        onClick={() => navigate(navigation.goBack)}
      />
      <IconButton
        icon="arrow-right"
        aria-label="应用前进"
        testId="e2e/shared/navigation/forward#button"
        disabled={!navigation.canGoForward}
        onClick={() => navigate(navigation.goForward)}
      />
      {sidebar?.collapsed ? (
        <IconButton
          icon="panel-left"
          aria-label="展开侧栏"
          testId="e2e/shared/sidebar/restore#button"
          onClick={sidebar.onToggle}
        />
      ) : sidebar ? (
        <IconButton
          icon="panel-left"
          aria-label="折叠侧栏"
          testId="e2e/shared/sidebar/collapse#button"
          onClick={sidebar.onToggle}
        />
      ) : (
        <span className="app-window-control-placeholder" aria-hidden="true" />
      )}
    </div>
  )
}
