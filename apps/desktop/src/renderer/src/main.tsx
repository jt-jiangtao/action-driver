import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import { App } from './App'
import { createRendererServices } from './di/container'
import { AppServicesProvider } from './di/services-context'
import { resolveDesktopCompositionMode } from '../../shared/composition-mode'
import './styles/global.css'

const compositionMode = resolveDesktopCompositionMode(import.meta.env.MODE)
const services = createRendererServices(
  compositionMode === 'mock'
    ? { mode: 'mock' }
    : { mode: 'local', desktopApi: window.productDesktop }
)

createRoot(document.getElementById('root')!).render(
  <AppServicesProvider services={services}>
    <App />
  </AppServicesProvider>
)
