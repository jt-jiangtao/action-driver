import { render, screen, within, type RenderOptions } from '@testing-library/react'
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
  it('shows per-capability probe results and allows a tested image default', async () => {
    const user = userEvent.setup()
    const seed = (await new MockModelConnectionsService({ delayMs: 0 }).list()).slice(0, 1)
    seed[0]!.models.push({
      id: 'wan2.7-image', name: 'wan2.7-image', enabled: true, testState: 'untested',
      capabilities: { image_generation: { state: 'success', source: 'probe' } }
    })
    const service = new MockModelConnectionsService({ delayMs: 0, seed })
    renderWithQuery(<SettingsPage service={service} onBack={() => undefined} />)
    await screen.findByText('公司模型网关')
    expect(screen.queryByRole('combobox', { name: 'gpt-5.2 模型类型' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'gpt-5.2 生图接口' })).toBeNull()
    await user.click(screen.getByRole('button', { name: '设为默认生图模型：wan2.7-image' }))
    expect(await service.getDefaultImageModel()).toEqual({
      connectionId: 'company-gateway', modelId: 'wan2.7-image'
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
    expect(await within(dialog).findAllByText('文本 · 通过')).toHaveLength(3)
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
    const testModelsSpy = vi.spyOn(service, 'testModels')
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
    expect(dialog).toHaveAttribute('data-view-state', 'models-testing')
    expect(await within(dialog).findByText('文本 · 失败')).toBeVisible()
    expect(within(dialog).getAllByText('文本 · 通过')).toHaveLength(2)
    expect(dialog).toHaveAttribute('data-view-state', 'models-partial-failure')
  })
})
