// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { createBrowserDesktopService } from '../../src/service'

test('explicit host setup, command execution and idempotent disposal', async () => {
  const host = {
    setup: vi.fn(async () => ({ apiManifest: { interfaces: {} }, disabledMemberIds: ['Tab.cua'] })),
    execute: vi.fn(async (command: unknown) => ({ command })),
    displayImage: vi.fn(), close: vi.fn(async () => {})
  }
  const service = createBrowserDesktopService({ host, environment: 'training' })
  await expect(service.execute({ type: 'list_browsers' })).rejects.toThrow('BROWSER_DESKTOP_NOT_SETUP')
  expect(await service.setup()).toEqual({ apiManifest: { interfaces: {} }, disabledMemberIds: ['Tab.cua'] })
  expect(await service.execute({ type: 'list_browsers' })).toEqual({ command: { type: 'list_browsers' } })
  await service.dispose()
  await service.dispose()
  expect(host.close).toHaveBeenCalledOnce()
  await expect(service.execute({ type: 'list_browsers' })).rejects.toThrow('BROWSER_DESKTOP_CLOSED')
})

test('codex-app can list ordinary tabs while its missing auth safety resource stays unavailable', async () => {
  const host = {
    setup: vi.fn(async () => ({ apiManifest: { interfaces: {} }, disabledMemberIds: [] })),
    execute: vi.fn(async () => [{ id: 'local', name: 'Action-Driver Chrome' }]),
    displayImage: vi.fn(), close: vi.fn(async () => {})
  }
  const service = createBrowserDesktopService({ host, environment: 'codex-app' })
  await service.setup()
  expect(await service.execute({ type: 'list_browsers' }))
    .toEqual([{ id: 'local', name: 'Action-Driver Chrome' }])
  await expect(service.execute({ type: 'tab_browser_auth_handoff', tab_id: '1' }))
    .rejects.toThrow('BROWSER_AUTH_SAFETY_PRECHECK_UNAVAILABLE')
  await service.dispose()
})
