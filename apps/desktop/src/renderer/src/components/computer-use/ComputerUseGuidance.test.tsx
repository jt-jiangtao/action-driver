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

    expect(await screen.findByRole('heading', { name: 'Enable Codex Computer Use' })).toBeVisible()
    expect(screen.getByText('Allows Codex to access app interfaces')).toBeVisible()
    expect(screen.getByText('Codex uses screenshots to know where to click')).toBeVisible()
    expect(screen.queryByText(/Chrome/)).toBeNull()
    expect(screen.queryByText('ActionDriver')).toBeNull()
    expect(screen.queryByText(/Event/i)).toBeNull()
    expect(screen.getAllByText('Done')).toHaveLength(1)
    expect(api.permissions).toHaveBeenCalledOnce()
    expect(api.requestPermissions).not.toHaveBeenCalled()

    await userEvent.click(screen.getByTestId('e2e/computer-use/guidance/allow-accessibility#button'))
    expect(api.requestPermissions).toHaveBeenCalledWith('accessibility')
    await waitFor(() => expect(screen.getAllByText('Done')).toHaveLength(2))

    expect(api.requestPermissions).toHaveBeenCalledOnce()
  })

  it('shows the system-settings placeholder while an authorized capability is still pending', async () => {
    const api = stubComputerUse({ requestPermissions: vi.fn(async () => ({
      accessibility: false, screenRecording: true, eventPosting: false,
      permissionTarget: 'ActionDriver Computer Use'
    })) })
    render(<ComputerUseGuidance />)
    await screen.findByRole('heading', { name: 'Enable Codex Computer Use' })

    await userEvent.click(screen.getByTestId('e2e/computer-use/guidance/allow-accessibility#button'))
    expect(await screen.findByTestId('e2e/computer-use/guidance/pending#status')).toBeVisible()
    expect(api.requestPermissions).toHaveBeenCalledOnce()
  })

  it('returns to the first window from the back action and rechecks permissions', async () => {
    const api = stubComputerUse()
    render(<ComputerUseGuidance />)
    await screen.findByRole('heading', { name: 'Enable Codex Computer Use' })
    await waitFor(() => expect(screen.getByTestId('e2e/computer-use/guidance/recheck#button')).toBeEnabled())

    await userEvent.click(screen.getByTestId('e2e/computer-use/guidance/open-settings#button'))
    expect(api.openSystemSettings).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByTestId('e2e/computer-use/guidance/recheck#button'))
    await waitFor(() => expect(api.permissions).toHaveBeenCalledTimes(2))

    await userEvent.click(screen.getByTestId('e2e/computer-use/guidance/back#button'))
    expect(api.closeGuidance).toHaveBeenCalledOnce()
  })
})
