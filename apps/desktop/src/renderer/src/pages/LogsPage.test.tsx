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
    expect(screen.getAllByText('失败 · unauthorized').length).toBeGreaterThan(0)

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

  it('selects an entry and shows its details', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.queryByTestId('e2e/settings/logs/inspector#section')).not.toBeInTheDocument()
    const entries = await screen.findAllByTestId(/e2e\/settings\/logs\/entries\/\d+#button/)
    await user.click(entries[0]!)

    const inspector = screen.getByTestId('e2e/settings/logs/inspector#section')
    expect(within(inspector).getByText('actiondriver:model-connections:list')).toBeVisible()
    expect(within(inspector).getByText('页面 → 服务端')).toBeVisible()
    expect(within(inspector).getByText('12ms')).toBeVisible()
    expect(within(inspector).getByText('1.7KB · 2 项')).toBeVisible()
    expect(within(inspector).getByText('页面 → 服务端')).toBeVisible()

    await user.click(entries[0]!)
    expect(screen.queryByTestId('e2e/settings/logs/inspector#section')).not.toBeInTheDocument()
  })

  it('copies the selected entry', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    })
    renderPage()
    await screen.findByText('actiondriver:model-connections:list')

    const entries = await screen.findAllByTestId(/e2e\/settings\/logs\/entries\/\d+#button/)
    await user.click(entries[0]!)
    await user.click(screen.getByTestId('e2e/settings/logs/inspector/copy#button'))

    expect(writeText).toHaveBeenCalledOnce()
    const copied = writeText.mock.calls[0]?.[0]
    expect(typeof copied).toBe('string')
    expect(String(copied)).toContain('actiondriver:model-connections:list')
  })

  it('expands and collapses the raw record', async () => {
    const user = userEvent.setup()
    renderPage()
    const entries = await screen.findAllByTestId(/e2e\/settings\/logs\/entries\/\d+#button/)
    await user.click(entries[0]!)

    const toggle = screen.getByTestId('e2e/settings/logs/raw#button')
    expect(toggle.closest('details')).toHaveAttribute('open')
    await user.click(toggle)
    expect(toggle.closest('details')).not.toHaveAttribute('open')
  })

  it('shows the empty and failure states', async () => {
    const { unmount } = renderPage({ list: async () => ({ records: [], files: ['/tmp/logs/renderer-service.log'] }) })
    expect(await screen.findByText('还没有交互记录')).toBeVisible()
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
