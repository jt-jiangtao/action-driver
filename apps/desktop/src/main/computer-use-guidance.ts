import {
  COMPUTER_GUIDANCE_ENSURE_CHANNEL,
  type ComputerPermissionStatus
} from '../shared/computer-use-contract'

/**
 * Decides whether starting Computer Use should guide the user: only when a required permission is
 * missing. The helper is launched through LaunchServices, so its readings are its own grants in
 * development and packaged builds alike. An unreadable status does not prove anything is missing,
 * and the guidance window lives in that same unreachable helper, so it does not guide either.
 */
export function shouldOpenComputerUseGuidance(status: ComputerPermissionStatus | null): boolean {
  if (!status) return false
  // Posting input events rides on the Accessibility grant, so it needs no authorization of its own.
  return !status.accessibility || !status.screenRecording
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
    readPermissions(): Promise<ComputerPermissionStatus | null>
  }
): void {
  ipc.handle(COMPUTER_GUIDANCE_ENSURE_CHANNEL, async () => {
    const status = await options.readPermissions().catch(() => null)
    if (!shouldOpenComputerUseGuidance(status)) return false
    await options.present()
    return true
  })
}
