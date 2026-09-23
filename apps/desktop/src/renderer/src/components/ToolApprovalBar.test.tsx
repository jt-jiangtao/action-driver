import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ToolApprovalBar } from './ToolApprovalBar'

describe('ToolApprovalBar', () => {
  it('shows only a pending approval and sends its stable identity', async () => {
    const approve = vi.fn(async () => undefined)
    render(
      <ToolApprovalBar
        tools={[
          {
            callId: 'call-1',
            toolId: 'sandbox.shell.run',
            modelName: 'sandbox_shell_run',
            summary: '执行 rg',
            argumentsHash: 'sha256:1',
            status: 'waiting_approval'
          }
        ]}
        onApprove={approve}
        onReject={vi.fn(async () => undefined)}
      />
    )
    await userEvent.setup().click(screen.getByRole('button', { name: '允许一次' }))
    expect(approve).toHaveBeenCalledWith('call-1', 'sha256:1')
  })
})
