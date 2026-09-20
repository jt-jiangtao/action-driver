import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@actiondriver/design-tokens/tokens.css'
import { App } from './App'
import { createRendererContainer, resolveAppServices } from './di/container'
import { AppServicesProvider } from './di/services-context'
import './styles/global.css'

const services = resolveAppServices(createRendererContainer({ mode: 'mock' }))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppServicesProvider services={services}>
      <App />
    </AppServicesProvider>
  </StrictMode>
)
