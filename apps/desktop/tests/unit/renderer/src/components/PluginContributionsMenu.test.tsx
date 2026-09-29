import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PluginContributionsMenu } from '../../../../../src/renderer/src/components/plugins/PluginContributionsMenu'
import { AppServicesProvider } from '../../../../../src/renderer/src/di/services-context'
import { createRendererServices } from '../../../../../src/renderer/src/di/container'
import type { PluginContributionsService } from '../../../../../src/renderer/src/services/plugin-contributions'

function renderMenu(service: PluginContributionsService, taskId?: string) {
  const services = createRendererServices({ mode: 'mock', pluginContributions: service })
  return render(
    <AppServicesProvider services={services}>
      <PluginContributionsMenu {...(taskId ? { taskId } : {})} />
    </AppServicesProvider>
  )
}

const contributions = {
  views: [
    { pluginId: 'ui', version: '1.0.0', definition: { id: 'ui.dashboard', title: '面板', container: 'sidebar' as const, entry: 'view.html', messages: {} }, available: true },
    { pluginId: 'ui', version: '1.0.0', definition: { id: 'ui.locked', title: '受限面板', container: 'sidebar' as const, entry: 'locked.html', messages: {} }, available: false }
  ],
  menus: [
    { pluginId: 'ui', version: '1.0.0', definition: { id: 'ui.refresh-menu', title: '刷新', command: 'ui.refresh', location: 'plugins-menu' as const }, available: true },
    { pluginId: 'ui', version: '1.0.0', definition: { id: 'ui.blocked-menu', title: '受限操作', command: 'ui.blocked', location: 'plugins-menu' as const }, available: false }
  ]
}

describe('plugin contribution entries', () => {
  it('renders the runtime availability, opens a view and runs the bound command with the task', async () => {
    const openView = vi.fn(async () => undefined), executeCommand = vi.fn(async () => null)
    renderMenu({ list: async () => contributions, openView, executeCommand }, 'task-1')
    const view = await screen.findByRole('button', { name: '面板' })
    expect(view).toBeEnabled()
    expect(screen.getByRole('button', { name: '受限面板' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '受限操作' })).toBeDisabled()
    await userEvent.click(view)
    expect(openView).toHaveBeenCalledWith('ui', 'ui.dashboard')
    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(executeCommand).toHaveBeenCalledWith({ pluginId: 'ui', commandId: 'ui.refresh', taskId: 'task-1' })
  })

  it('surfaces a runtime refusal instead of pretending the entry succeeded', async () => {
    const executeCommand = vi.fn(async () => { throw new Error('UNAVAILABLE: ui.refresh: context condition is false') })
    renderMenu({ list: async () => contributions, openView: async () => undefined, executeCommand })
    await userEvent.click(await screen.findByRole('button', { name: '刷新' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('context condition is false'))
  })
})
