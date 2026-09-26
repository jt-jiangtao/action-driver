import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComputerUseGuidance } from './ComputerUseGuidance'

afterEach(() => { vi.unstubAllGlobals() })

function stubComputerUse(overrides: Record<string, unknown> = {}) {
  const pending = { accessibility: false, screenRecording: true, eventPosting: false,
    permissionTarget: 'ActionDriver Computer Use' }
  const api = {
    permissions: vi.fn(async () => pending),
    requestPermissions: vi.fn(async () => ({ ...pending, accessibility: true })),
    openSystemSettings: vi.fn(async () => undefined),
    closeGuidance: vi.fn(async () => undefined),
    ...overrides
  }
  vi.stubGlobal('actionDriverDesktop', { computerUse: api })
  return api
}

describe('Computer Use guidance window', () => {
  it('lists only the permissions this app can grant and only requests after an explicit allow', async () => {
    const api = stubComputerUse()
    render(<ComputerUseGuidance />)

    expect(await screen.findByRole('heading', { name: '启用 Codex Computer Use' })).toBeVisible()
    expect(screen.getByText('允许 Codex 访问 App 界面')).toBeVisible()
    expect(screen.getByText('Codex 通过截图判断该点哪里')).toBeVisible()
    expect(screen.queryByText(/Chrome/)).toBeNull()
    expect(screen.queryByText('ActionDriver')).toBeNull()
    expect(screen.queryByText('输入事件')).toBeNull()
    expect(screen.getAllByText('已完成')).toHaveLength(1)
    expect(api.permissions).toHaveBeenCalledOnce()
    expect(api.requestPermissions).not.toHaveBeenCalled()

    await userEvent.click(screen.getByTestId('e2e/computer-use/guidance/allow-accessibility#button'))
    expect(api.requestPermissions).toHaveBeenCalledWith('accessibility')
    await waitFor(() => expect(screen.getAllByText('已完成')).toHaveLength(2))

    expect(api.requestPermissions).toHaveBeenCalledOnce()
  })

  it('shows the system-settings placeholder while an authorized capability is still pending', async () => {
    const api = stubComputerUse({ requestPermissions: vi.fn(async () => ({
      accessibility: false, screenRecording: true, eventPosting: false,
      permissionTarget: 'ActionDriver Computer Use'
    })) })
    render(<ComputerUseGuidance />)
    await screen.findByRole('heading', { name: '启用 Codex Computer Use' })

    await userEvent.click(screen.getByTestId('e2e/computer-use/guidance/allow-accessibility#button'))
    expect(await screen.findByTestId('e2e/computer-use/guidance/pending#status')).toBeVisible()
    expect(api.requestPermissions).toHaveBeenCalledOnce()
  })

  it('rechecks after the user returns from System Settings and leaves on Escape', async () => {
    const api = stubComputerUse()
    render(<ComputerUseGuidance />)
    await screen.findByRole('heading', { name: '启用 Codex Computer Use' })
    expect(api.permissions).toHaveBeenCalledOnce()

    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(api.permissions).toHaveBeenCalledTimes(2))

    await userEvent.keyboard('{Escape}')
    expect(api.closeGuidance).toHaveBeenCalledOnce()
  })
})
