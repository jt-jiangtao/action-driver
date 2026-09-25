import type { BrowserWindowConstructorOptions } from 'electron'
import {
  COMPUTER_GUIDANCE_CLOSE_CHANNEL,
  COMPUTER_GUIDANCE_ENSURE_CHANNEL,
  COMPUTER_GUIDANCE_SURFACE,
  COMPUTER_GUIDANCE_SURFACE_PARAM,
  type ComputerPermissionStatus
} from '../shared/computer-use-contract'

/** Points the shared renderer bundle at the standalone guidance surface. */
export function computerUseGuidanceUrl(rendererEntryUrl: string): string {
  const url = new URL(rendererEntryUrl)
  url.searchParams.set(COMPUTER_GUIDANCE_SURFACE_PARAM, COMPUTER_GUIDANCE_SURFACE)
  return url.href
}

/**
 * The guidance window is deliberately fixed and non-closable: the user leaves it through the
 * in-window back action, which returns to the main window instead of stranding the task.
 */
export function computerUseGuidanceWindowOptions(
  preloadPath: string,
  iconPath: string
): BrowserWindowConstructorOptions {
  return {
    width: 560,
    height: 640,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    minimizable: true,
    closable: false,
    show: false,
    // The guidance window mirrors the reference window, which shows no title text at all.
    title: '',
    icon: iconPath,
    backgroundColor: '#F5F5F7',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  }
}

/**
 * Decides whether starting Computer Use should guide the user.
 *
 * Ad-hoc development builds inherit the host process's TCC identity, so a "granted" reading cannot
 * prove that the helper itself is authorized; those builds always guide instead of assuming
 * success. A signed packaged build guides only when a permission is genuinely missing.
 */
export function shouldOpenComputerUseGuidance(options: {
  status: ComputerPermissionStatus | null
  isPackaged: boolean
}): boolean {
  if (!options.status) return true
  // Posting input events rides on the Accessibility grant, so it needs no authorization of its own.
  if (!options.status.accessibility || !options.status.screenRecording) return true
  return !options.isPackaged
}

export function registerComputerUseGuidanceIpc(
  ipc: {
    handle(
      channel: string,
      handler: (_event: unknown, input: unknown) => Promise<unknown>
    ): void
  },
  options: {
    open(): void
    close(): void
    focusMain(): void
    isPackaged: boolean
    readPermissions(): Promise<ComputerPermissionStatus | null>
  }
): void {
  ipc.handle(COMPUTER_GUIDANCE_ENSURE_CHANNEL, async () => {
    const status = await options.readPermissions().catch(() => null)
    if (!shouldOpenComputerUseGuidance({ status, isPackaged: options.isPackaged })) return false
    options.open()
    return true
  })
  ipc.handle(COMPUTER_GUIDANCE_CLOSE_CHANNEL, async () => {
    options.close()
    options.focusMain()
  })
}
