import {
  COMPUTER_GUIDANCE_ENSURE_CHANNEL,
  type ComputerPermissionStatus
} from '../shared/computer-use-contract'

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
    present(): Promise<void> | void
    isPackaged: boolean
    readPermissions(): Promise<ComputerPermissionStatus | null>
  }
): void {
  ipc.handle(COMPUTER_GUIDANCE_ENSURE_CHANNEL, async () => {
    const status = await options.readPermissions().catch(() => null)
    if (!shouldOpenComputerUseGuidance({ status, isPackaged: options.isPackaged })) return false
    await options.present()
    return true
  })
}
