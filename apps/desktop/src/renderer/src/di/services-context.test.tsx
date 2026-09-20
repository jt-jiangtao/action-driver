import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createRendererContainer, resolveAppServices } from './container'
import { AppServicesProvider, useAppServices } from './services-context'

function Probe() {
  const services = useAppServices()
  return <span data-testid="service-name">{services.agentCommandService.constructor.name}</span>
}

describe('renderer service context', () => {
  it('provides resolved services without exposing the container', () => {
    const services = resolveAppServices(createRendererContainer({ mode: 'mock' }))

    render(
      <AppServicesProvider services={services}>
        <Probe />
      </AppServicesProvider>
    )

    expect(screen.getByTestId('service-name')).toHaveTextContent('MockAgentRuntime')
  })

  it('fails clearly when the provider is missing', () => {
    expect(() => render(<Probe />)).toThrow('AppServicesProvider is missing')
  })
})
