import type { TaskProjection } from '@actiondriver/contracts'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../../../src/renderer/src/App'
import type * as SidebarModule from '../../../../src/renderer/src/components/Sidebar'
import { createRendererServices } from '../../../../src/renderer/src/di/container'
import { AppServicesProvider } from '../../../../src/renderer/src/di/services-context'
import { mockTaskFixture } from '../../../../src/renderer/src/services/mock-task-fixture'

const renders = vi.hoisted(() => ({ sidebar: 0 }))

// The sidebar takes inline callbacks and is not memoized, so it renders exactly when the app shell
// does; counting it counts shell renders.
vi.mock('../../../../src/renderer/src/components/Sidebar', async (importOriginal) => {
  const original = await importOriginal<typeof SidebarModule>()
  return {
    Sidebar: (props: Parameters<typeof original.Sidebar>[0]) => {
      renders.sidebar += 1
      return original.Sidebar(props)
    }
  }
})

describe('App during streaming', () => {
  beforeEach(() => {
    sessionStorage.clear()
    renders.sidebar = 0
  })

  it('updates the task page without re-rendering the app shell', async () => {
    const services = createRendererServices({ mode: 'mock' })
    const listeners = new Set<(task: TaskProjection) => void>()
    const repository = services.agentSessionRepository
    services.agentSessionRepository = {
      getTask: (taskId) => repository.getTask(taskId),
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
    render(
      <AppServicesProvider services={services}>
        <App initialRoute="task" />
      </AppServicesProvider>
    )
    await screen.findByTestId('e2e/tasks/detail/page#page')
    await screen.findByRole('button', { name: /预订周末去杭州的酒店/ })
    const shellRenders = renders.sidebar

    let streamed: TaskProjection = { ...mockTaskFixture, status: 'running' }
    for (let index = 0; index < 5; index += 1) {
      streamed = {
        ...streamed,
        messages: [
          ...mockTaskFixture.messages,
          { id: 'agent-streaming', role: 'agent', content: `流式片段 ${index}` }
        ]
      }
      const update = streamed
      act(() => listeners.forEach((listener) => listener(update)))
    }

    expect(await screen.findByText('流式片段 4')).toBeVisible()
    expect(renders.sidebar).toBe(shellRenders)
  })
})
