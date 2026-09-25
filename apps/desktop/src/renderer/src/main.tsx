import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import { App } from './App'
import { createRendererServices } from './di/container'
import { AppServicesProvider } from './di/services-context'
import { ComputerUseGuidance } from './components/computer-use/ComputerUseGuidance'
import { resolveDesktopCompositionMode } from '../../shared/composition-mode'
import {
  COMPUTER_GUIDANCE_SURFACE,
  COMPUTER_GUIDANCE_SURFACE_PARAM
} from '../../shared/computer-use-contract'
import './styles/global.css'

const root = createRoot(document.getElementById('root')!)
const guidanceSurface =
  new URLSearchParams(window.location.search).get(COMPUTER_GUIDANCE_SURFACE_PARAM) ===
  COMPUTER_GUIDANCE_SURFACE

if (guidanceSurface) {
  // The guidance window shares this bundle but is its own surface: no application shell, no
  // runtime services, only the authorization flow.
  root.render(
    <StrictMode>
      <ComputerUseGuidance />
    </StrictMode>
  )
} else {
  const compositionMode = resolveDesktopCompositionMode(import.meta.env.MODE)
  const services = createRendererServices(
    compositionMode === 'mock'
      ? { mode: 'mock' }
      : { mode: 'local', desktopApi: window.actionDriverDesktop }
  )
  root.render(
    <StrictMode>
      <AppServicesProvider services={services}>
        <App />
      </AppServicesProvider>
    </StrictMode>
  )
}
