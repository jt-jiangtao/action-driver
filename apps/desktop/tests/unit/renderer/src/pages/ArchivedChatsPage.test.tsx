import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ArchivedChatsPage } from '../../../../../src/renderer/src/pages/ArchivedChatsPage'
import type { TaskCatalog } from '../../../../../src/renderer/src/models/task-catalog'

const old = {
  id: 'old',
  sessionId: 'session-old',
  title: '旧聊天',
  state: 'default' as const,
  archivedAt: '2026-09-29T00:00:00.000Z'
}
const later = {
  id: 'later',
  sessionId: 'session-later',
  title: '后续页的关键聊天',
  state: 'default' as const,
  archivedAt: '2026-09-28T00:00:00.000Z'
}

function show(catalog: TaskCatalog) {
  const onOpenTask = vi.fn()
  render(
    <ArchivedChatsPage
      catalog={catalog}
      onBack={vi.fn()}
      onOpenTask={onOpenTask}
      onRestored={vi.fn()}
      onOpenConnections={vi.fn()}
      onOpenMainPrompt={vi.fn()}
      onOpenSkills={vi.fn()}
      onOpenComputerUse={vi.fn()}
    />
  )
  return { onOpenTask }
}

describe('ArchivedChatsPage', () => {
  it('requires confirmation before permanently deleting an archived chat', async () => {
    const user = userEvent.setup()
    const deleteSession = vi.fn(async () => {})
    show({
      listRecentTasks: async () => [],
      getTask: async () => null,
      listArchivedTasks: async () => ({ items: deleteSession.mock.calls.length ? [] : [old], nextCursor: null }),
      deleteSession
    })
    await user.click(await screen.findByTestId('e2e/settings/archived/old/delete#button'))
    expect(screen.getByRole('dialog', { name: '永久删除聊天？' })).toBeVisible()
    await user.click(screen.getByTestId('e2e/settings/archived/delete/cancel#button'))
    expect(deleteSession).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('e2e/settings/archived/old/delete#button'))
    await user.click(screen.getByTestId('e2e/settings/archived/delete/confirm#button'))
    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith('session-old'))
    expect(await screen.findByText('聊天已永久删除')).toBeVisible()
    expect(screen.queryByTestId('e2e/settings/archived/old/open#button')).not.toBeInTheDocument()
  })

  it('shows a retry after the catalog fails to load', async () => {
    const user = userEvent.setup()
    let attempts = 0
    show({
      listRecentTasks: async () => [],
      getTask: async () => null,
      listArchivedTasks: async () => {
        if (++attempts === 1) throw new Error('目录暂不可用')
        return { items: [old], nextCursor: null }
      }
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('目录暂不可用')
    await user.click(screen.getByTestId('e2e/settings/archived/retry#button'))
    expect(await screen.findByText('旧聊天')).toBeVisible()
  })

  it('searches all archived chats and loads another page without duplicates', async () => {
    const user = userEvent.setup()
    const listArchivedTasks = vi.fn(async (query: string, cursor?: string | null) => {
      if (query) return { items: [later], nextCursor: null }
      return cursor ? { items: [later], nextCursor: null } : { items: [old], nextCursor: 'next' }
    })
    const { onOpenTask } = show({
      listRecentTasks: async () => [],
      getTask: async () => null,
      listArchivedTasks
    })
    expect(await screen.findByText('旧聊天')).toBeVisible()
    await user.click(screen.getByTestId('e2e/settings/archived/more#button'))
    expect(await screen.findByText('后续页的关键聊天')).toBeVisible()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    await user.click(screen.getByTestId('e2e/settings/archived/later/open#button'))
    expect(onOpenTask).toHaveBeenCalledWith('later')
    await user.type(screen.getByTestId('e2e/settings/archived/search#input'), '关键')
    expect(await screen.findByText('后续页的关键聊天')).toBeVisible()
    expect(screen.queryByText('旧聊天')).not.toBeInTheDocument()
    expect(listArchivedTasks).toHaveBeenCalledWith('关键', null)
  })
})
