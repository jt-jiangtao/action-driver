import { render, screen, within, waitFor, type RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPage } from './SettingsPage'
import { MockModelConnectionsService } from '../services/mock-model-connections'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

function renderWithQuery(element: ReactElement, options?: RenderOptions) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>, options)
}

describe('SettingsPage model connections', () => {
  it('starts four model tests concurrently and starts the fifth after one finishes', async () => {
    const user = userEvent.setup()
    const models = Array.from({ length: 5 }, (_, index) => ({
      id: `model-${index}`,
      name: `model-${index}`,
      enabled: true,
      testState: 'untested' as const,
      probeCandidates: ['text' as const, 'reasoning' as const, 'vision' as const]
    }))
    const service = new MockModelConnectionsService({
      delayMs: 0,
      seed: [
        {
          id: 'company-gateway',
          name: '公司模型网关',
          protocol: 'openai-compatible',
          baseUrl: 'https://example.com/v1',
          apiKeyHint: '••••1234',
          expanded: true,
          models
        }
      ]
    })
    vi.spyOn(service, 'refresh').mockResolvedValue(models)
    const finish: Array<() => void> = []
    const test = vi.spyOn(service, 'testConnectionModels').mockImplementation(
      async (_connectionId, ids) =>
        new Promise((resolve) => {
          finish.push(() =>
            resolve([
              {
                modelId: ids[0]!,
                state: 'success',
                capabilities: {
                  text: { state: 'success', source: 'probe' },
                  reasoning: { state: 'success', source: 'probe' },
                  vision: { state: 'success', source: 'probe' }
                }
              }
            ])
          )
        })
    )
    renderWithQuery(<SettingsPage service={service} onBack={() => undefined} />)
    await user.click(await screen.findByRole('button', { name: /刷新并测试公司模型网关/ }))
    await waitFor(() => expect(test).toHaveBeenCalledTimes(4))
    const queuedRow = screen.getByText('model-4').closest<HTMLElement>('.model-row')!
    expect(within(queuedRow).getByText('文本 · 测试中')).toBeVisible()
    expect(within(queuedRow).getByText('推理 · 测试中')).toBeVisible()
    expect(within(queuedRow).getByText('视觉 · 测试中')).toBeVisible()
    finish[0]?.()
    await waitFor(() => expect(test).toHaveBeenCalledTimes(5))
    for (const release of finish.slice(1)) release()
    expect(await screen.findByText('测试完成 · 5/5')).toBeVisible()
  })

  it('refreshes and tests every probeable model with visible batch progress', async () => {
    const user = userEvent.setup()
    const service = new MockModelConnectionsService({ delayMs: 0 })
    const actualRefresh = service.refresh.bind(service)
    const refresh = vi.spyOn(service, 'refresh').mockImplementation(async (connectionId) => [
      ...(await actualRefresh(connectionId)),
      {
        id: 'audio-only',
        name: 'audio-only',
        enabled: true,
        testState: 'untested',
        catalogLabels: ['speech_recognition']
      }
    ])
    const test = vi.spyOn(service, 'testConnectionModels')
    renderWithQuery(<SettingsPage service={service} onBack={() => undefined} />)
    await user.click(await screen.findByRole('button', { name: /刷新并测试公司模型网关/ }))
    await waitFor(() => expect(test).toHaveBeenCalledTimes(4))
    expect(refresh).toHaveBeenCalledExactlyOnceWith('company-gateway')
    expect(test.mock.calls.map((call) => call[1])).toEqual([
      ['gpt-5.2'],
      ['gpt-5.2-mini'],
      ['gpt-4.1'],
      ['audio-only']
    ])
    expect(await screen.findByText('测试完成 · 4/4')).toBeVisible()
  })

  it('continues a refresh batch after one model request fails', async () => {
    const user = userEvent.setup()
    const service = new MockModelConnectionsService({ delayMs: 0 })
    const actualTest = service.testConnectionModels.bind(service)
    const test = vi
      .spyOn(service, 'testConnectionModels')
      .mockRejectedValueOnce(new Error('服务暂不可用'))
      .mockImplementation((connectionId, modelIds) => actualTest(connectionId, modelIds))
    renderWithQuery(<SettingsPage service={service} onBack={() => undefined} />)
    await user.click(await screen.findByRole('button', { name: /刷新并测试公司模型网关/ }))
    expect(await screen.findAllByText('文本 · 失败')).not.toHaveLength(0)
    expect(screen.queryByText('服务暂不可用')).not.toBeInTheDocument()
    await waitFor(() => expect(test).toHaveBeenCalledTimes(3))
    expect(await screen.findByText('测试完成 · 3/3')).toBeVisible()
  })

  it('shows discovery errors next to the connection and allows refreshing again', async () => {
    const user = userEvent.setup()
    const service = new MockModelConnectionsService({ delayMs: 0 })
    const refresh = vi.spyOn(service, 'refresh').mockRejectedValueOnce(new Error('连接超时'))
    renderWithQuery(<SettingsPage service={service} onBack={() => undefined} />)
    await user.click(await screen.findByRole('button', { name: /刷新并测试公司模型网关/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('刷新失败')
    expect(screen.queryByText('连接超时')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /刷新并测试公司模型网关/ }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('测试完成 · 3/3')).toBeVisible()
  })

  it('shows a single-model request error and permits retry', async () => {
    const user = userEvent.setup()
    const service = new MockModelConnectionsService({ delayMs: 0 })
    const test = vi
      .spyOn(service, 'testConnectionModels')
      .mockRejectedValueOnce(new Error('连接超时'))
    renderWithQuery(<SettingsPage service={service} onBack={() => undefined} />)
    await user.click(await screen.findByRole('button', { name: '测试gpt-5.2' }))
    expect(await screen.findAllByText('文本 · 失败')).not.toHaveLength(0)
    expect(screen.queryByText('连接超时')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '测试gpt-5.2' }))
    await waitFor(() => expect(test).toHaveBeenCalledTimes(2))
  })

  it('keeps batch and manual probes from overlapping', async () => {
    const user = userEvent.setup()
    const service = new MockModelConnectionsService({ delayMs: 0 })
    const actualTest = service.testConnectionModels.bind(service)
    const actualRefresh = service.refresh.bind(service)
    let releaseManual: (() => void) | undefined
    const manualGate = new Promise<void>((resolve) => {
      releaseManual = resolve
    })
    vi.spyOn(service, 'testConnectionModels').mockImplementationOnce(async (connectionId, ids) => {
      await manualGate
      return actualTest(connectionId, ids)
    })
    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    vi.spyOn(service, 'refresh').mockImplementationOnce(async (connectionId) => {
      await refreshGate
      return actualRefresh(connectionId)
    })
    renderWithQuery(<SettingsPage service={service} onBack={() => undefined} />)
    const manual = await screen.findByRole('button', { name: '测试gpt-5.2' })
    const refresh = screen.getByRole('button', { name: '刷新并测试公司模型网关' })
    await user.click(manual)
    expect(refresh).toBeDisabled()
    releaseManual?.()
    await waitFor(() => expect(refresh).toBeEnabled())
    await user.click(refresh)
    expect(manual).toBeDisabled()
    releaseRefresh?.()
    expect(await screen.findByText('测试完成 · 3/3')).toBeVisible()
  })

  it('shows per-capability probe results and allows a tested image default', async () => {
    const user = userEvent.setup()
    const seed = (await new MockModelConnectionsService({ delayMs: 0 }).list()).slice(0, 1)
    seed[0]!.models.push({
      id: 'wan2.7-image',
      name: 'wan2.7-image',
      enabled: true,
      testState: 'untested',
      capabilities: { image_generation: { state: 'success', source: 'probe' } }
    })
    const service = new MockModelConnectionsService({ delayMs: 0, seed })
    renderWithQuery(<SettingsPage service={service} onBack={() => undefined} />)
    await screen.findByText('公司模型网关')
    await user.click(screen.getByRole('button', { name: '测试gpt-5.2' }))
    const chatRow = screen.getByText('gpt-5.2').closest<HTMLElement>('.model-row')!
    expect(await within(chatRow).findByText('生图 · 失败')).toBeVisible()
    expect(screen.queryByRole('combobox', { name: 'gpt-5.2 模型类型' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'gpt-5.2 生图接口' })).toBeNull()
    await user.click(screen.getByRole('button', { name: '设为默认生图模型：wan2.7-image' }))
    expect(await service.getDefaultImageModel()).toEqual({
      connectionId: 'company-gateway',
      modelId: 'wan2.7-image'
    })
  })

  it('does not require a model type when adding a connection', async () => {
    const user = userEvent.setup()
    const service = new MockModelConnectionsService({ delayMs: 0, seed: [] })
    renderWithQuery(<SettingsPage service={service} onBack={() => undefined} />)
    await screen.findByText('还没有模型集')
    await user.click(screen.getByRole('button', { name: '添加模型集' }))
    const dialog = screen.getByRole('dialog', { name: '添加模型集' })
    expect(within(dialog).queryByText('手动配置生图模型')).toBeNull()
    expect(within(dialog).queryByRole('combobox', { name: /模型类型/ })).toBeNull()
  })

  it('reuses cached connections when the settings page is reopened', async () => {
    const service = new MockModelConnectionsService({ delayMs: 0 })
    const list = vi.spyOn(service, 'list')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const renderPage = () => (
      <QueryClientProvider client={client}>
        <SettingsPage service={service} onBack={() => undefined} />
      </QueryClientProvider>
    )
    const first = render(renderPage())
    expect(await screen.findByText('公司模型网关')).toBeVisible()
    first.unmount()
    const second = render(renderPage())
    expect(await screen.findByText('公司模型网关')).toBeVisible()
    expect(list).toHaveBeenCalledOnce()
    second.unmount()
  })

  it('renders connection cards and expands or collapses their model rows', async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <SettingsPage service={new MockModelConnectionsService({ delayMs: 0 })} onBack={() => {}} />
    )

    expect(screen.getByRole('heading', { name: '模型连接' })).toBeVisible()
    expect(await screen.findByText('公司模型网关')).toBeVisible()
    expect(screen.getByText('gpt-5.2')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '收起公司模型网关' }))
    expect(screen.queryByText('gpt-5.2')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '展开公司模型网关' }))
    expect(screen.getByText('gpt-5.2')).toBeVisible()
  })

  it('confirms before deleting and preserves the card when deletion is cancelled', async () => {
    const user = userEvent.setup()
    const service = new MockModelConnectionsService({ delayMs: 0 })
    const deleteSpy = vi.spyOn(service, 'delete')
    renderWithQuery(<SettingsPage service={service} onBack={() => {}} />)

    await user.click(await screen.findByRole('button', { name: '公司模型网关的更多操作' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: '删除模型集' })).toBeVisible()
    await user.click(within(menu).getByRole('menuitem', { name: '删除模型集' }))

    const confirmation = screen.getByRole('dialog', { name: '删除模型集' })
    expect(deleteSpy).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole('button', { name: '取消' }))
    expect(screen.getByText('公司模型网关')).toBeVisible()

    await user.click(await screen.findByRole('button', { name: '公司模型网关的更多操作' }))
    await user.click(screen.getByRole('menuitem', { name: '删除模型集' }))
    await user.click(
      within(screen.getByRole('dialog', { name: '删除模型集' })).getByRole('button', {
        name: '确认删除'
      })
    )

    expect(deleteSpy).toHaveBeenCalledOnce()
    expect(screen.queryByText('公司模型网关')).not.toBeInTheDocument()
    expect(await screen.findByText('Anthropic 生产连接')).toBeVisible()
  })

  it('opens and cancels add-model-set from the designed empty state', async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <SettingsPage
        service={new MockModelConnectionsService({ delayMs: 0, seed: [] })}
        onBack={() => {}}
      />
    )

    expect(await screen.findByText('还没有模型集')).toBeVisible()
    expect(screen.getByText('连接模型服务')).toBeVisible()
    expect(screen.getByRole('button', { name: '添加模型集' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '添加模型集' }))
    expect(screen.getByRole('dialog', { name: '添加模型集' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '添加模型集' })).not.toBeInTheDocument()
  })

  it('enters the empty state after confirming deletion of the last model set', async () => {
    const user = userEvent.setup()
    const seed = (await new MockModelConnectionsService({ delayMs: 0 }).list()).slice(0, 1)
    renderWithQuery(
      <SettingsPage
        service={new MockModelConnectionsService({ delayMs: 0, seed })}
        onBack={() => {}}
      />
    )

    await user.click(await screen.findByRole('button', { name: '公司模型网关的更多操作' }))
    await user.click(screen.getByRole('menuitem', { name: '删除模型集' }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    expect(await screen.findByText('还没有模型集')).toBeVisible()
    expect(screen.queryByText('公司模型网关')).not.toBeInTheDocument()
  })

  it('configures a connection, discovers models, and saves without a manual-add row', async () => {
    const user = userEvent.setup()
    const service = new MockModelConnectionsService({ delayMs: 0 })
    renderWithQuery(<SettingsPage service={service} onBack={() => {}} />)

    await screen.findByText('公司模型网关')
    await user.click(screen.getByRole('button', { name: '添加模型集' }))
    const dialog = screen.getByRole('dialog', { name: '添加模型集' })
    expect(dialog).toHaveAttribute('data-view-state', 'connection-idle')
    await user.type(within(dialog).getByLabelText('名称'), '研发模型服务')
    await user.type(within(dialog).getByLabelText('接口地址'), 'https://models.example.com/v1')
    await user.type(within(dialog).getByLabelText('API 密钥'), 'sk-mock')
    await user.click(within(dialog).getByRole('button', { name: '测试连接' }))

    expect(await within(dialog).findByText('连接成功')).toBeVisible()
    expect(dialog).toHaveAttribute('data-view-state', 'connection-success')
    await user.click(within(dialog).getByRole('button', { name: '下一步' }))

    expect(await within(dialog).findByText('gpt-5.2')).toBeVisible()
    expect(dialog).toHaveAttribute('data-view-state', 'models-untested')
    expect(within(dialog).getByRole('button', { name: '手动添加模型' })).toHaveAttribute(
      'title',
      '手动添加模型'
    )
    expect(within(dialog).queryByText('手动添加模型')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '上一步' }))
    expect(within(dialog).getByLabelText('名称')).toHaveValue('研发模型服务')
    expect(within(dialog).getByText('连接成功')).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: '下一步' }))
    expect(within(dialog).getByText('gpt-5.2')).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: '测试全部模型' }))
    expect(await within(dialog).findAllByText('文本 · 成功')).toHaveLength(3)
    expect(dialog).toHaveAttribute('data-view-state', 'models-success')
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('研发模型服务')).toBeVisible()
  })

  it('shows independent testing states and a deterministic partial failure', async () => {
    const user = userEvent.setup()
    const service = new MockModelConnectionsService({
      delayMs: 25,
      seed: [],
      modelResults: { 'gpt-5.2-mini': false }
    })
    const testConnectionSpy = vi.spyOn(service, 'testConnection')
    const runTestModels = service.testModels.bind(service)
    let finishModelTests!: () => void
    const modelTestsHeld = new Promise<void>((resolve) => { finishModelTests = resolve })
    const testModelsSpy = vi.spyOn(service, 'testModels').mockImplementation(async (draft, modelIds) => {
      await modelTestsHeld
      return runTestModels(draft, modelIds)
    })
    renderWithQuery(<SettingsPage service={service} onBack={() => {}} />)

    await screen.findByText('还没有模型集')
    await user.click(screen.getByRole('button', { name: '添加模型集' }))
    const dialog = screen.getByRole('dialog', { name: '添加模型集' })
    await user.type(within(dialog).getByLabelText('名称'), '测试网关')
    await user.type(within(dialog).getByLabelText('接口地址'), 'https://test.example.com/v1')
    await user.type(within(dialog).getByLabelText('API 密钥'), 'sk-test')
    await user.dblClick(within(dialog).getByRole('button', { name: '测试连接' }))
    expect(testConnectionSpy).toHaveBeenCalledOnce()
    expect(dialog).toHaveAttribute('data-view-state', 'connection-testing')
    await within(dialog).findByText('连接成功')
    await user.click(within(dialog).getByRole('button', { name: '下一步' }))
    await within(dialog).findByText('gpt-5.2-mini')

    await user.dblClick(within(dialog).getByRole('button', { name: '测试全部模型' }))
    expect(testModelsSpy).toHaveBeenCalledOnce()
    expect(dialog).toHaveAttribute('data-view-state', 'models-testing')
    finishModelTests()
    expect(await within(dialog).findByText('文本 · 失败')).toBeVisible()
    expect(within(dialog).getAllByText('文本 · 成功')).toHaveLength(2)
    expect(dialog).toHaveAttribute('data-view-state', 'models-partial-failure')
  })
})
