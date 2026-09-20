import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@actiondriver/design-tokens/tokens.css'
import { App } from './App'
import { createRendererContainer, resolveAppServices } from './di/container'
import './styles/global.css'

const services = resolveAppServices(createRendererContainer())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App services={services} />
  </StrictMode>
)
