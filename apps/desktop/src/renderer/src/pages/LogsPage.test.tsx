import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LogsPage } from './LogsPage'
import { SettingsSidebar } from '../components/SettingsSidebar'
import { MockInteractionLogService } from '../services/desktop-interaction-logs'
import type { InteractionLogRecord, InteractionLogService } from '../models/interaction-logs'
import type { InteractionLogDetail } from '@actiondriver/observability'

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

  it('filters by one or more real transport protocols', async () => {
    const user = userEvent.setup()
    const list = vi.fn(async () => ({ records: [], nextCursor: null, files: [] }))
    renderPage({ list })

    await user.click(screen.getByTestId('e2e/settings/logs/transport#button'))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'IPC' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'WebSocket' }))

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ transports: ['ipc', 'websocket'] })
      )
    )
    expect(screen.queryByText('OpenAI')).not.toBeInTheDocument()
    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument()
  })

  it('loads request and response lazily for the selected event', async () => {
    const user = userEvent.setup()
    const record = { ...createRecords(1)[0]!, id: 'main:event-1' }
    const detail = createDetail(record, {
      requestText: '{"goal":"检查日志"}',
      responseText: '{"taskId":"task-1"}'
    })
    const service = {
      list: vi.fn(async () => ({ records: [record], nextCursor: null, files: [] })),
      detail: vi.fn(async () => detail)
    }
    renderPage(service)

    await user.click(await screen.findByTestId('e2e/settings/logs/entries/0#button'))

    expect(service.detail).toHaveBeenCalledWith('main:event-1')
    await user.click(await screen.findByTestId('e2e/settings/logs/inspector/request#button'))
    expect(await screen.findByText('{"goal":"检查日志"}')).toBeVisible()
    await user.click(screen.getByTestId('e2e/settings/logs/inspector/response#button'))
    expect(screen.getByText('{"taskId":"task-1"}')).toBeVisible()
  })

  it('ignores a stale detail response after another event is selected', async () => {
    const user = userEvent.setup()
    const records = createRecords(2).map((record, index) => ({
      ...record,
      id: `main:event-${index + 1}`
    }))
    let resolveFirst!: (detail: InteractionLogDetail) => void
    const detail = vi.fn((eventId: string) =>
      eventId === 'main:event-1'
        ? new Promise<InteractionLogDetail>((resolve) => {
            resolveFirst = resolve
          })
        : Promise.resolve(createDetail(records[1]!, { requestText: 'second request' }))
    )
    renderPage({
      list: async () => ({ records, nextCursor: null, files: [] }),
      detail
    })

    const entries = await screen.findAllByTestId(/e2e\/settings\/logs\/entries\/\d+#button/)
    await user.click(entries[0]!)
    await user.click(entries[1]!)
    await user.click(await screen.findByTestId('e2e/settings/logs/inspector/request#button'))
    expect(await screen.findByText('second request')).toBeVisible()

    resolveFirst(createDetail(records[0]!, { requestText: 'stale first request' }))
    await waitFor(() => expect(screen.queryByText('stale first request')).not.toBeInTheDocument())
    expect(screen.getByText('second request')).toBeVisible()
  })

  it('renders unavailable, binary, truncated and pending payload states truthfully', async () => {
    const user = userEvent.setup()
    const record = {
      ...createRecords(1)[0]!,
      id: 'main:event-states',
      state: 'pending' as const,
      requestTruncated: true
    }
    const detail = createDetail(record, { requestText: 'partial request' })
    detail.state = 'pending'
    detail.request = { ...detail.request!, truncated: true }
    detail.response = null
    const first = renderPage({
      list: async () => ({ records: [record], nextCursor: null, files: [] }),
      detail: async () => detail
    })

    await user.click(await screen.findByTestId('e2e/settings/logs/entries/0#button'))
    const request = await screen.findByTestId('e2e/settings/logs/inspector/request#button')
    expect(screen.getAllByText('进行中').length).toBeGreaterThan(0)
    expect(within(request).getByText('已截断')).toBeVisible()
    await user.click(request)
    expect(screen.getByText('partial request')).toBeVisible()
    await user.click(screen.getByTestId('e2e/settings/logs/inspector/response#button'))
    expect(screen.getByText('等待响应')).toBeVisible()
    first.unmount()

    detail.request = {
      kind: 'json',
      contentType: 'application/json',
      byteLength: 100,
      truncated: false,
      text: null,
      unavailableReason: 'expired'
    }
    detail.response = {
      kind: 'binary-metadata',
      contentType: 'application/octet-stream',
      byteLength: 2_048,
      truncated: false,
      text: null,
      unavailableReason: null
    }
    const secondRecord = { ...record, id: 'main:event-states-2', state: 'completed' as const }
    const secondDetail = { ...detail, id: secondRecord.id, state: 'completed' as const }
    renderPage({
      list: async () => ({ records: [secondRecord], nextCursor: null, files: [] }),
      detail: async () => secondDetail
    })
    await user.click(await screen.findByTestId('e2e/settings/logs/entries/0#button'))
    await user.click(await screen.findByTestId('e2e/settings/logs/inspector/request#button'))
    expect(screen.getByText('载荷已过期')).toBeVisible()
    await user.click(screen.getByTestId('e2e/settings/logs/inspector/response#button'))
    expect(screen.getByText(/二进制载荷，仅保存元数据/)).toBeVisible()
  })

  it('labels incomplete and one-way events without calling them rejected', async () => {
    const records = createRecords(2).map((record, index) => ({
      ...record,
      id: `main:state-${index}`,
      ...(index === 0
        ? { state: 'incomplete' as const, outcome: 'incomplete' }
        : { state: 'completed' as const, kind: 'one-way-event' as const, outcome: 'sent' })
    }))
    renderPage({ list: async () => ({ records, nextCursor: null, files: [] }) })

    expect(await screen.findByText('未完成')).toBeVisible()
    expect(screen.getByText('单向事件')).toBeVisible()
  })

  it('shows an expired state when a retained summary no longer has detail', async () => {
    const user = userEvent.setup()
    const record = { ...createRecords(1)[0]!, id: 'service:expired' }
    renderPage({
      list: async () => ({ records: [record], nextCursor: null, files: [] }),
      detail: async () => Promise.reject({ code: 'payload-expired' })
    })

    await user.click(await screen.findByTestId('e2e/settings/logs/entries/0#button'))
    expect(await screen.findByText('载荷已过期')).toBeVisible()
  })

  it('clears all interface filters and restores the first page', async () => {
    const user = userEvent.setup()
    const records = createRecords(30)
    renderPage({ list: async () => ({ records, files: [] }) })

    await screen.findByText('operation-0')
    await user.click(screen.getByTestId('e2e/settings/logs/pagination/next#button'))
    expect(await screen.findByText('operation-12')).toBeVisible()

    await user.selectOptions(screen.getByTestId('e2e/settings/logs/level#select'), 'warn')
    await user.selectOptions(
      screen.getByTestId('e2e/settings/logs/direction#select'),
      'service->renderer'
    )
    await user.type(screen.getByTestId('e2e/settings/logs/search#input'), 'operation')
    await user.click(screen.getByTestId('e2e/settings/logs/filters/clear#button'))

    expect(screen.getByTestId('e2e/settings/logs/level#select')).toHaveValue('')
    expect(screen.getByTestId('e2e/settings/logs/direction#select')).toHaveValue('')
    expect(screen.getByTestId('e2e/settings/logs/search#input')).toHaveValue('')
    expect(await screen.findByText('operation-0')).toBeVisible()
  })

  it('paginates interface records without squeezing the log table', async () => {
    const user = userEvent.setup()
    renderPage({ list: async () => ({ records: createRecords(30), files: [] }) })

    expect(await screen.findByText('operation-0')).toBeVisible()
    expect(screen.queryByText('operation-12')).not.toBeInTheDocument()
    expect(screen.getByText(/第 1 \/ 3 页/)).toBeVisible()

    await user.click(screen.getByTestId('e2e/settings/logs/pagination/next#button'))
    expect(await screen.findByText('operation-12')).toBeVisible()
    expect(screen.queryByText('operation-0')).not.toBeInTheDocument()
    expect(screen.getByText(/第 2 \/ 3 页/)).toBeVisible()
  })

  it('exposes refresh progress and copy confirmation to assistive technology', async () => {
    const user = userEvent.setup()
    let resolveRefresh!: (value: { records: InteractionLogRecord[]; files: string[] }) => void
    const service = {
      list: vi
        .fn()
        .mockResolvedValue({ records: createRecords(1), files: [] })
        .mockResolvedValueOnce({ records: createRecords(1), files: [] })
        .mockImplementationOnce(
          () =>
            new Promise<{ records: InteractionLogRecord[]; files: string[] }>((resolve) => {
              resolveRefresh = resolve
            })
        )
    }
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => undefined) },
      configurable: true
    })
    renderPage(service)

    await screen.findByText('operation-0')
    await user.click(screen.getByTestId('e2e/settings/logs/refresh#button'))
    expect(screen.getByTestId('e2e/settings/logs/refresh#button')).toBeDisabled()
    expect(screen.getByText('刷新中…')).toBeVisible()
    resolveRefresh({ records: createRecords(1), files: [] })
    await waitFor(() =>
      expect(screen.getByTestId('e2e/settings/logs/refresh#button')).toBeEnabled()
    )

    await user.click(screen.getByTestId('e2e/settings/logs/entries/0#button'))
    const copy = await screen.findByTestId('e2e/settings/logs/inspector/copy#button')
    await user.click(copy)
    expect(copy).toHaveAccessibleName('已复制')
    expect(screen.getByRole('status')).toHaveTextContent('已复制')
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
    const request = await screen.findByTestId('e2e/settings/logs/inspector/request#button')
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
    const { unmount } = renderPage({
      list: async () => ({ records: [], files: ['/tmp/logs/renderer-service.log'] })
    })
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

    const systemPrompt = screen.getByTestId('e2e/settings/logs/model/detail/system-prompt#button')
    const modelRequest = screen.getByTestId('e2e/settings/logs/model/detail/model-request#button')
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

function createRecords(count: number): InteractionLogRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    level: 30,
    levelLabel: 'info',
    time: Date.parse('2026-09-22T02:20:00.000Z') + index,
    transport: 'ipc',
    direction: index % 2 === 0 ? 'renderer->service' : 'service->renderer',
    operation: `operation-${index}`,
    outcome: 'ok',
    durationMs: index + 1
  }))
}

function createDetail(
  record: InteractionLogRecord,
  payloads: { requestText?: string; responseText?: string }
): InteractionLogDetail {
  const payload = (text: string | undefined) =>
    text === undefined
      ? null
      : {
          kind: 'json' as const,
          contentType: 'application/json',
          byteLength: Buffer.byteLength(text),
          truncated: false,
          text,
          unavailableReason: null
        }
  return {
    id: record.id!,
    correlationId: record.correlationId ?? record.id!,
    time: record.time,
    completedAt: record.time + (record.durationMs ?? 0),
    transport: 'ipc',
    direction: 'renderer->service',
    kind: 'request-response',
    state: 'completed',
    operation: record.operation ?? 'operation',
    level: record.level,
    levelLabel: record.levelLabel,
    outcome: 'ok',
    durationMs: record.durationMs ?? 0,
    requestBytes: payloads.requestText?.length ?? 0,
    responseBytes: payloads.responseText?.length ?? 0,
    requestAvailable: payloads.requestText !== undefined,
    responseAvailable: payloads.responseText !== undefined,
    requestTruncated: false,
    responseTruncated: false,
    request: payload(payloads.requestText),
    response: payload(payloads.responseText)
  }
}

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
