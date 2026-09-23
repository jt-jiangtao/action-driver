import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ToolInvocationProjection } from '@actiondriver/contracts'
import { ToolApprovalBar } from './ToolApprovalBar'

const waiting: ToolInvocationProjection = {
  callId: 'call-1',
  toolId: 'sandbox.shell.run',
  modelName: 'sandbox_shell_run',
  summary: `rg ${'long-pattern-'.repeat(30)} README.md`,
  argumentsHash: 'sha256:abc',
  status: 'waiting_approval'
}

describe('ToolApprovalBar', () => {
  it('shows the complete command accessibly and disables duplicate decisions while pending', async () => {
    const user = userEvent.setup()
    let release!: () => void
    const onApprove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    render(<ToolApprovalBar tools={[waiting]} onApprove={onApprove} onReject={vi.fn()} />)
    expect(screen.getByTitle(waiting.summary)).toBeVisible()
    expect(screen.getByRole('button', { name: '允许一次' })).toBeVisible()
    expect(screen.getByRole('button', { name: '拒绝' })).toBeVisible()
    await user.tab()
    expect(screen.getByRole('button', { name: '拒绝' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: '允许一次' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '允许一次' }))
    expect(onApprove).toHaveBeenCalledWith('call-1', 'sha256:abc')
    expect(screen.getByRole('button', { name: '允许中' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '拒绝' })).toBeDisabled()
    release()
  })

  it('occupies no space after the call becomes terminal', () => {
    const { container, rerender } = render(
      <ToolApprovalBar tools={[waiting]} onApprove={vi.fn()} onReject={vi.fn()} />
    )
    rerender(
      <ToolApprovalBar
        tools={[{ ...waiting, status: 'completed' }]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('rejects a waiting call without invoking approval', async () => {
    const user = userEvent.setup()
    const onApprove = vi.fn(async () => undefined)
    const onReject = vi.fn(async () => undefined)
    render(<ToolApprovalBar tools={[waiting]} onApprove={onApprove} onReject={onReject} />)
    await user.click(screen.getByRole('button', { name: '拒绝' }))
    expect(onReject).toHaveBeenCalledWith('call-1', 'sha256:abc')
    expect(onApprove).not.toHaveBeenCalled()
  })
})
