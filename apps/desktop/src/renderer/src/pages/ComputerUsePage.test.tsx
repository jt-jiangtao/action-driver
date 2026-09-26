import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComputerUsePage } from './ComputerUsePage'

afterEach(() => { vi.unstubAllGlobals() })

function renderPage() {
  return render(<ComputerUsePage onBack={() => undefined} onOpenConnections={() => undefined}
    onOpenMainPrompt={() => undefined} onOpenSkills={() => undefined} />)
}

function stubComputerUse(status: {
  accessibility: boolean
  screenRecording: boolean
  eventPosting: boolean
}) {
  const permissions = vi.fn(async () => ({ ...status,
    permissionTarget: 'ActionDriver Computer Use' }))
  const api = {
    permissions,
    ensureGuidance: vi.fn(async () => true),
    openSystemSettings: vi.fn(async () => undefined)
  }
  vi.stubGlobal('actionDriverDesktop', { computerUse: api })
  return api
}

describe('Computer Use settings page', () => {
  it('offers a single any-app control that reports the live authorization', async () => {
    stubComputerUse({ accessibility: true, screenRecording: true, eventPosting: true })
    renderPage()

    expect(await screen.findByRole('heading', { name: '电脑操控' })).toBeVisible()
    expect(screen.getByText('管理 ActionDriver 如何使用你电脑上的其他应用程序')).toBeVisible()
    expect(screen.getByText('任意应用')).toBeVisible()
    expect(screen.getByText('允许 ActionDriver 控制你电脑上的应用')).toBeVisible()
    await waitFor(() => expect(screen.getByTestId('e2e/settings/computer-use/any-app#switch'))
      .toHaveAttribute('aria-checked', 'true'))
    expect(screen.getByText('辅助功能已授权')).toBeVisible()
    expect(screen.getByText('屏幕录制已授权')).toBeVisible()
    expect(screen.queryByText('始终允许的应用')).toBeNull()
    expect(screen.queryByTestId('e2e/settings/computer-use/open-guidance#button')).toBeNull()
  })

  it('shows the guidance button only while authorization is missing and refreshes on demand', async () => {
    const api = stubComputerUse({ accessibility: false, screenRecording: false, eventPosting: false })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('e2e/settings/computer-use/any-app#switch'))
      .toHaveAttribute('aria-checked', 'false'))
    const guidanceButton = screen.getByTestId('e2e/settings/computer-use/open-guidance#button')
    await userEvent.click(guidanceButton)
    expect(api.ensureGuidance).toHaveBeenCalledOnce()
    expect(screen.getByText('辅助功能未授权')).toBeVisible()
    expect(screen.getByText('屏幕录制未授权')).toBeVisible()

    await userEvent.click(screen.getByTestId('e2e/settings/computer-use/recheck#button'))
    await waitFor(() => expect(api.permissions).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('e2e/settings/computer-use/open-guidance#button')).toBeVisible()
  })

  it('sends an authorized toggle to System Settings because only macOS can revoke it', async () => {
    const api = stubComputerUse({ accessibility: true, screenRecording: true, eventPosting: true })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('e2e/settings/computer-use/any-app#switch'))
      .toHaveAttribute('aria-checked', 'true'))

    await userEvent.click(screen.getByTestId('e2e/settings/computer-use/any-app#switch'))
    expect(api.openSystemSettings).toHaveBeenCalledOnce()
  })
})
