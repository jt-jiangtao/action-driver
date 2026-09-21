import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@actiondriver/design-tokens/tokens.css'
import { App } from './App'
import { createRendererContainer, resolveAppServices } from './di/container'
import { AppServicesProvider } from './di/services-context'
import { resolveDesktopCompositionMode } from '../../shared/composition-mode'
import './styles/global.css'

const compositionMode = resolveDesktopCompositionMode(import.meta.env.MODE)
const services = resolveAppServices(
  createRendererContainer(
    compositionMode === 'mock'
      ? { mode: 'mock' }
      : { mode: 'local', desktopApi: window.actionDriverDesktop }
  )
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppServicesProvider services={services}>
      <App />
    </AppServicesProvider>
  </StrictMode>
)
