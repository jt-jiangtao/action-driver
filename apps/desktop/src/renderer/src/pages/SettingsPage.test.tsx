import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPage } from './SettingsPage'
import { MockModelConnectionsService } from '../services/mock-model-connections'

describe('SettingsPage model connections', () => {
  it('renders connection cards and expands or collapses their model rows', async () => {
    const user = userEvent.setup()
    render(<SettingsPage service={new MockModelConnectionsService({ delayMs: 0 })} onBack={() => {}} />)

    expect(screen.getByRole('heading', { name: '模型连接' })).toBeVisible()
    expect(screen.getByText('公司模型网关')).toBeVisible()
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
    render(<SettingsPage service={service} onBack={() => {}} />)

    await user.click(screen.getByRole('button', { name: '公司模型网关的更多操作' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: '删除模型集' })).toBeVisible()
    await user.click(within(menu).getByRole('menuitem', { name: '删除模型集' }))

    const confirmation = screen.getByRole('dialog', { name: '删除模型集' })
    expect(deleteSpy).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole('button', { name: '取消' }))
    expect(screen.getByText('公司模型网关')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '公司模型网关的更多操作' }))
    await user.click(screen.getByRole('menuitem', { name: '删除模型集' }))
    await user.click(within(screen.getByRole('dialog', { name: '删除模型集' })).getByRole('button', { name: '确认删除' }))

    expect(deleteSpy).toHaveBeenCalledOnce()
    expect(screen.queryByText('公司模型网关')).not.toBeInTheDocument()
    expect(screen.getByText('Anthropic 生产连接')).toBeVisible()
  })

  it('renders the designed empty state when there are no model sets', () => {
    render(
      <SettingsPage
        service={new MockModelConnectionsService({ delayMs: 0, seed: [] })}
        onBack={() => {}}
      />
    )

    expect(screen.getByText('还没有模型集')).toBeVisible()
    expect(screen.getByText('连接模型服务')).toBeVisible()
    expect(screen.getByRole('button', { name: '添加模型集' })).toBeVisible()
  })

  it('enters the empty state after confirming deletion of the last model set', async () => {
    const user = userEvent.setup()
    const seed = new MockModelConnectionsService({ delayMs: 0 }).list().slice(0, 1)
    render(
      <SettingsPage
        service={new MockModelConnectionsService({ delayMs: 0, seed })}
        onBack={() => {}}
      />
    )

    await user.click(screen.getByRole('button', { name: '公司模型网关的更多操作' }))
    await user.click(screen.getByRole('menuitem', { name: '删除模型集' }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    expect(screen.getByText('还没有模型集')).toBeVisible()
    expect(screen.queryByText('公司模型网关')).not.toBeInTheDocument()
  })

  it('configures a connection, discovers models, and saves without a manual-add row', async () => {
    const user = userEvent.setup()
    const service = new MockModelConnectionsService({ delayMs: 0 })
    render(<SettingsPage service={service} onBack={() => {}} />)

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
    expect(await within(dialog).findAllByText('成功')).toHaveLength(3)
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
    render(<SettingsPage service={service} onBack={() => {}} />)

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
    expect(within(dialog).getAllByText('测试中')).toHaveLength(3)
    expect(dialog).toHaveAttribute('data-view-state', 'models-testing')
    expect(await within(dialog).findByText('失败')).toBeVisible()
    expect(within(dialog).getAllByText('成功')).toHaveLength(2)
    expect(dialog).toHaveAttribute('data-view-state', 'models-partial-failure')
  })
})
