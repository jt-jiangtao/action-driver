import type { TaskProjection } from '@actiondriver/contracts'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createRendererServices } from './container'
import { mockTaskFixture } from '../services/mock-task-fixture'
import { AppServicesProvider, useAppServices, useTaskStore, useTaskStoreApi } from './services-context'

function Probe() {
  const services = useAppServices()
  return <span data-testid="service-name">{services.agentCommandService.constructor.name}</span>
}

describe('renderer service context', () => {
  it('provides resolved services without exposing the container', () => {
    const services = createRendererServices({ mode: 'mock' })

    render(
      <AppServicesProvider services={services}>
        <Probe />
      </AppServicesProvider>
    )

    expect(screen.getByTestId('service-name')).toHaveTextContent('MockAgentRuntime')
  })

  it('provides a task store that follows the session repository while mounted', () => {
    const services = createRendererServices({ mode: 'mock' })
    const listeners = new Set<(task: TaskProjection) => void>()
    services.agentSessionRepository = {
      ...services.agentSessionRepository,
      getTask: services.agentSessionRepository.getTask.bind(services.agentSessionRepository),
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
    function TitleProbe() {
      const title = useTaskStore((state) => state.activeTask?.title ?? 'none')
      const store = useTaskStoreApi()
      return (
        <button type="button" onClick={() => store.getState().open({ ...mockTaskFixture, title: 'opened' })}>
          {title}
        </button>
      )
    }

    const view = render(
      <AppServicesProvider services={services}>
        <TitleProbe />
      </AppServicesProvider>
    )
    act(() => screen.getByRole('button').click())
    act(() => listeners.forEach((listener) => listener({ ...mockTaskFixture, title: 'streamed' })))
    expect(screen.getByRole('button')).toHaveTextContent('streamed')

    view.unmount()
    expect(listeners.size).toBe(0)
  })

  it('fails clearly when the provider is missing', () => {
    expect(() => render(<Probe />)).toThrow('AppServicesProvider is missing')
  })
})
