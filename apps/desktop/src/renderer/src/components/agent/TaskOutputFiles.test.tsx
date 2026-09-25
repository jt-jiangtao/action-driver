import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TaskOutputFiles } from './TaskOutputFiles'

const files = [
  {
    fileId: 'file-1',
    sessionId: 'session-1',
    taskId: 'task-1',
    name: '季度报告.pdf',
    mimeType: 'application/pdf',
    byteLength: 4096,
    kind: 'document' as const
  },
  {
    fileId: 'file-2',
    sessionId: 'session-1',
    taskId: 'task-1',
    name: 'chart.png',
    mimeType: 'image/png',
    byteLength: 2048,
    kind: 'image' as const
  }
]

function withBridge(open: (input: unknown) => Promise<void>) {
  ;(window as unknown as { actionDriverDesktop?: unknown }).actionDriverDesktop = {
    taskOutput: { open }
  }
}

describe('task output files', () => {
  it('shows each deliverable with format, name, size and an open action', async () => {
    const user = userEvent.setup()
    const open = vi.fn(async () => undefined)
    withBridge(open)
    render(<TaskOutputFiles files={files} />)

    const cards = screen.getAllByTestId('e2e/tasks/detail/output-file#section')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent('季度报告.pdf')
    expect(cards[0]).toHaveTextContent('4 KiB')
    expect(screen.getByAltText('PDF')).toHaveAttribute('src', expect.stringContaining('file-pdf'))
    expect(screen.getByAltText('PNG')).toBeInTheDocument()

    const openButtons = screen.getAllByRole('button', { name: '打开文件' })
    openButtons[1]!.focus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith({
        fileId: 'file-2',
        taskId: 'task-1',
        sessionId: 'session-1'
      })
    )
  })

  it('keeps the failure visible on the card without breaking other cards', async () => {
    const user = userEvent.setup()
    withBridge(async () => {
      throw new Error('TASK_OUTPUT_UNAVAILABLE')
    })
    render(<TaskOutputFiles files={files} />)

    await user.click(screen.getAllByRole('button', { name: '打开文件' })[0]!)

    expect(await screen.findByRole('alert')).toHaveTextContent('TASK_OUTPUT_UNAVAILABLE')
    expect(screen.getAllByTestId('e2e/tasks/detail/output-file#section')).toHaveLength(2)
  })
})
