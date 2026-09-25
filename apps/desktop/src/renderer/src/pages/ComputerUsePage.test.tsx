import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComputerUsePage } from './ComputerUsePage'

afterEach(() => { vi.unstubAllGlobals() })

describe('Computer Use permission settings', () => {
  it('shows each live permission and rechecks after the user returns from System Settings', async () => {
    const permissions = vi.fn()
      .mockResolvedValueOnce({ accessibility: false, screenRecording: false,
        eventPosting: false, permissionTarget: 'ActionDriver Computer Use' })
      .mockResolvedValueOnce({ accessibility: true, screenRecording: true,
        eventPosting: true, permissionTarget: 'ActionDriver Computer Use' })
    const openSystemSettings = vi.fn(async () => undefined)
    vi.stubGlobal('actionDriverDesktop', { computerUse: { permissions, openSystemSettings } })
    render(<ComputerUsePage onBack={() => undefined} onOpenConnections={() => undefined}
      onOpenMainPrompt={() => undefined} onOpenSkills={() => undefined} />)
    expect(await screen.findByText('辅助功能：未授权')).toBeVisible()
    expect(screen.getByText('屏幕与系统音频录制：未授权')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '打开系统设置' }))
    expect(openSystemSettings).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: '重新检测' }))
    expect(await screen.findByText('辅助功能：已授权')).toBeVisible()
    expect(permissions).toHaveBeenCalledTimes(2)
  })

  it('points at the automatic guidance instead of offering a manual entry', async () => {
    vi.stubGlobal('actionDriverDesktop', { computerUse: {
      permissions: vi.fn(async () => ({ accessibility: false, screenRecording: false,
        eventPosting: false, permissionTarget: 'ActionDriver Computer Use' })),
      openSystemSettings: vi.fn(async () => undefined)
    } })
    render(<ComputerUsePage onBack={() => undefined} onOpenConnections={() => undefined}
      onOpenMainPrompt={() => undefined} onOpenSkills={() => undefined} />)
    expect(await screen.findByText(/首次在任务中使用时会自动打开授权指引窗口/)).toBeVisible()
    expect(screen.queryByRole('button', { name: /授权指引/ })).toBeNull()
  })
})
