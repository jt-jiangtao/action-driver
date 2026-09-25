export const COMPUTER_PERMISSIONS_CHECK_CHANNEL = 'computer-use.permissions.check'
export const COMPUTER_PERMISSIONS_SETTINGS_CHANNEL = 'computer-use.permissions.open-settings'
export const COMPUTER_GUIDANCE_ENSURE_CHANNEL = 'computer-use.guidance.ensure'
export const COMPUTER_GUIDANCE_CLOSE_CHANNEL = 'computer-use.guidance.close'

/** Marks the renderer window that hosts the standalone authorization guidance. */
export const COMPUTER_GUIDANCE_SURFACE_PARAM = 'surface'
export const COMPUTER_GUIDANCE_SURFACE = 'computer-use'

export type ComputerPermissionStatus = {
  accessibility: boolean
  screenRecording: boolean
  eventPosting: boolean
  permissionTarget: string
}

export type ComputerPermissionKey = 'accessibility' | 'screenRecording' | 'eventPosting'
