import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { createRendererContainer, resolveAppServices } from './di/container'

describe('App', () => {
  it('submits the home goal into the mock task without adding extra pages', async () => {
    const user = userEvent.setup()
    render(<App services={resolveAppServices(createRendererContainer())} />)

    expect(screen.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
    await user.type(screen.getByLabelText('任务描述'), '预订杭州酒店')
    await user.click(screen.getByLabelText('发送'))

    expect(await screen.findByTestId('task-page')).toHaveAttribute('data-mode', 'split')
    expect(screen.getAllByText('预订周末去杭州的酒店')).toHaveLength(2)
  })

  it('switches between split, expanded, and collapsed browser layouts', async () => {
    const user = userEvent.setup()
    render(<App services={resolveAppServices(createRendererContainer())} initialRoute="task" />)

    await user.click(screen.getByLabelText('放大浏览器'))
    expect(screen.getByTestId('task-page')).toHaveAttribute('data-mode', 'browser-expanded')
    await user.click(screen.getByLabelText('缩小浏览器'))
    expect(screen.getByTestId('task-page')).toHaveAttribute('data-mode', 'split')
    await user.click(screen.getByLabelText('折叠浏览器'))
    expect(screen.getByTestId('task-page')).toHaveAttribute('data-mode', 'browser-collapsed')
    await user.click(screen.getByLabelText('展开浏览器'))
    expect(screen.getByTestId('task-page')).toHaveAttribute('data-mode', 'split')
  })

  it('reopens the current mock task from Recent Tasks after returning home', async () => {
    const user = userEvent.setup()
    render(<App services={resolveAppServices(createRendererContainer())} initialRoute="task" />)

    await user.click(screen.getByText('新任务'))
    expect(screen.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /预订周末去杭州的酒店/ }))

    expect(screen.getByTestId('task-page')).toBeVisible()
  })
})
