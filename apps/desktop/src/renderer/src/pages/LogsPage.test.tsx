import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LogsPage } from './LogsPage'
import { MockInteractionLogService } from '../services/desktop-interaction-logs'
import type { InteractionLogService } from '../models/interaction-logs'

function renderPage(service: InteractionLogService = new MockInteractionLogService()) {
  return render(
    <LogsPage service={service} onBack={() => {}} onOpenConnections={() => {}} autoRefreshMs={50} />
  )
}

describe('LogsPage', () => {
  it('renders interaction records and refreshes on demand', async () => {
    const user = userEvent.setup()
    const service = new MockInteractionLogService()
    const listSpy = vi.spyOn(service, 'list')
    renderPage(service)

    expect(await screen.findByText('actiondriver:model-connections:list')).toBeVisible()
    expect(screen.getAllByText('页面 → 服务端').length).toBeGreaterThan(0)
    expect(screen.getByText('unauthorized')).toBeVisible()

    await user.click(screen.getByTestId('e2e/settings/logs/refresh#button'))
    await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThan(1))
  })

  it('filters by level, direction and search', async () => {
    const user = userEvent.setup()
    const listSpy = vi.fn(async () => ({ records: [], files: [] }))
    renderPage({ list: listSpy })

    await user.selectOptions(screen.getByTestId('e2e/settings/logs/level#select'), 'warn')
    expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'warn' }))

    await user.selectOptions(
      screen.getByTestId('e2e/settings/logs/direction#select'),
      'service->renderer'
    )
    expect(listSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ direction: 'service->renderer' })
    )

    await user.type(screen.getByTestId('e2e/settings/logs/search#input'), 'model-connections')
    await waitFor(() =>
      expect(listSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'model-connections' })
      )
    )
  })

  it('pauses and resumes automatic refresh', async () => {
    const user = userEvent.setup()
    const service = new MockInteractionLogService()
    const listSpy = vi.spyOn(service, 'list')
    renderPage(service)
    await screen.findByText('actiondriver:model-connections:list')

    const toggle = screen.getByTestId('e2e/settings/logs/auto-refresh#switch')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    const callsAfterPause = listSpy.mock.calls.length

    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(listSpy.mock.calls.length).toBe(callsAfterPause)
  })

  it('shows the empty and failure states with the log file location', async () => {
    const { unmount } = renderPage({ list: async () => ({ records: [], files: ['/tmp/logs/renderer-service.log'] }) })
    expect(await screen.findByText('还没有交互记录')).toBeVisible()
    expect(screen.getByText('/tmp/logs/renderer-service.log')).toBeVisible()
    unmount()

    renderPage({
      list: async () => {
        throw new Error('permission denied')
      }
    })
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/无法读取日志/)).toBeVisible()
  })
})
