import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LogsPage } from './LogsPage'
import { SettingsSidebar } from '../components/SettingsSidebar'
import { MockInteractionLogService } from '../services/desktop-interaction-logs'
import type { InteractionLogService } from '../models/interaction-logs'

function renderPage(service: InteractionLogService = new MockInteractionLogService()) {
  return render(
    <LogsPage service={service} onBack={() => {}} onOpenConnections={() => {}} autoRefreshMs={50} />
  )
}

describe('LogsPage', () => {
  it('switches between real interface logs and mock model sessions', async () => {
    const user = userEvent.setup()
    const service = new MockInteractionLogService()
    const listSpy = vi.spyOn(service, 'list')
    renderPage(service)

    expect(await screen.findByText('actiondriver:model-connections:list')).toBeVisible()
    expect(screen.getByTestId('e2e/settings/logs/layer/interface#button')).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    await user.click(screen.getByTestId('e2e/settings/logs/layer/model#button'))

    expect(await screen.findByText('日常办公助手')).toBeVisible()
    expect(screen.queryByText('actiondriver:model-connections:list')).not.toBeInTheDocument()
    expect(listSpy).toHaveBeenCalled()
  })

  it('does not replace a real interface log failure with model mock data', async () => {
    renderPage({
      list: async () => {
        throw new Error('real source unavailable')
      }
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('real source unavailable')
    expect(screen.queryByText('日常办公助手')).not.toBeInTheDocument()
  })

  it('renders interaction records and refreshes on demand', async () => {
    const user = userEvent.setup()
    const service = new MockInteractionLogService()
    const listSpy = vi.spyOn(service, 'list')
    renderPage(service)

    expect(await screen.findByText('actiondriver:model-connections:list')).toBeVisible()
    expect(screen.getAllByText('页面 → 服务端').length).toBeGreaterThan(0)
    expect(screen.getAllByText('失败').length).toBeGreaterThan(0)

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

    await user.click(screen.getByTestId('e2e/settings/logs/inspector/close#button'))
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
    const request = screen.getByTestId('e2e/settings/logs/inspector/request#button')
    const response = screen.getByTestId('e2e/settings/logs/inspector/response#button')
    expect(toggle.closest('details')).toHaveAttribute('open')
    expect(request.closest('details')).not.toHaveAttribute('open')
    await user.click(request)
    await user.click(response)
    expect(request.closest('details')).toHaveAttribute('open')
    expect(response.closest('details')).toHaveAttribute('open')
    await user.click(toggle)
    expect(toggle.closest('details')).not.toHaveAttribute('open')
  })

  it('shows the empty and failure states', async () => {
    const user = userEvent.setup()
    const { unmount } = renderPage({ list: async () => ({ records: [], files: ['/tmp/logs/renderer-service.log'] }) })
    expect(await screen.findByText('还没有交互记录')).toBeVisible()
    unmount()

    const list = vi.fn(async () => {
      throw new Error('permission denied')
    })
    renderPage({ list })
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/无法读取日志/)).toBeVisible()
    await user.click(screen.getByTestId('e2e/settings/logs/retry#button'))
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1))
  })

  it('expands a model session and opens a full session detail view', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByTestId('e2e/settings/logs/layer/model#button'))
    const sessionToggle = await screen.findByTestId(
      'e2e/settings/logs/model/sessions/office-assistant#button'
    )
    await user.click(sessionToggle)

    expect(screen.getByText('天气报告')).toBeVisible()
    expect(screen.getByText('会议纪要')).toBeVisible()

    await user.click(
      screen.getByTestId('e2e/settings/logs/model/session-details/office-assistant#button')
    )
    expect(await screen.findByRole('heading', { name: '日常办公助手' })).toBeVisible()
    expect(screen.getByText('调用导航')).toBeVisible()
    expect(screen.getByText('系统提示词')).toBeVisible()
    expect(screen.getByText('Browser 组件')).toBeVisible()

    await user.click(screen.getByTestId('e2e/settings/logs/model/calls/browser-open#button'))
    expect(screen.getByText('打开天气查询页')).toBeVisible()

    await user.click(
      screen.getByTestId('e2e/settings/logs/model/task-switcher/meeting-notes#button')
    )
    expect(screen.getByText('模型层日志 · 会议纪要')).toBeVisible()

    await user.click(screen.getByTestId('e2e/settings/logs/model/detail/back#button'))
    expect(await screen.findByText('天气报告')).toBeVisible()
  })

  it('opens and closes independent model detail sections', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByTestId('e2e/settings/logs/layer/model#button'))
    await user.click(
      await screen.findByTestId('e2e/settings/logs/model/sessions/office-assistant#button')
    )
    await user.click(screen.getByTestId('e2e/settings/logs/model/tasks/weather-report#button'))

    const systemPrompt = screen.getByTestId(
      'e2e/settings/logs/model/detail/system-prompt#button'
    )
    const modelRequest = screen.getByTestId(
      'e2e/settings/logs/model/detail/model-request#button'
    )
    expect(systemPrompt).toHaveAttribute('aria-expanded', 'true')
    expect(modelRequest).toHaveAttribute('aria-expanded', 'false')

    await user.click(modelRequest)
    expect(modelRequest).toHaveAttribute('aria-expanded', 'true')
    expect(systemPrompt).toHaveAttribute('aria-expanded', 'true')
    await user.click(systemPrompt)
    expect(systemPrompt).toHaveAttribute('aria-expanded', 'false')
  })

  it('filters model records and switches between session and task views', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByTestId('e2e/settings/logs/layer/model#button'))
    await user.type(screen.getByTestId('e2e/settings/logs/model/search#input'), '产品方案')
    await user.selectOptions(screen.getByTestId('e2e/settings/logs/model/status#select'), 'running')
    expect(screen.getByText('产品方案撰写')).toBeVisible()
    expect(screen.queryByText('技术问题排查')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('e2e/settings/logs/model/view/tasks#button'))
    expect(screen.getByTestId('e2e/settings/logs/model/task-cards/outline#button')).toBeVisible()
    await user.click(screen.getByTestId('e2e/settings/logs/model/view/sessions#button'))
    expect(screen.getByText('产品方案撰写')).toBeVisible()

    const refresh = screen.getByTestId('e2e/settings/logs/model/auto-refresh#switch')
    await user.click(refresh)
    expect(refresh).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('SettingsSidebar', () => {
  it('keeps model connections and logs with distinct semantic icons', () => {
    render(
      <SettingsSidebar
        active="logs"
        onBack={() => {}}
        onOpenConnections={() => {}}
        onOpenLogs={() => {}}
      />
    )

    const connections = screen.getByTestId('e2e/settings/sidebar/model-connections#button')
    const logs = screen.getByTestId('e2e/settings/sidebar/logs#button')
    expect(connections).toHaveTextContent('模型连接')
    expect(logs).toHaveTextContent('日志')
    expect(connections.querySelector('svg')).toHaveClass('lucide-cable')
    expect(logs.querySelector('svg')).toHaveClass('lucide-scroll-text')
  })
})
