export const COMPUTER_PERMISSIONS_CHECK_CHANNEL = 'computer-use.permissions.check'
export const COMPUTER_PERMISSIONS_SETTINGS_CHANNEL = 'computer-use.permissions.open-settings'
export const COMPUTER_GUIDANCE_ENSURE_CHANNEL = 'computer-use.guidance.ensure'
export const COMPUTER_APP_ICON_CHANNEL = 'computer-use.application.icon'

export type ComputerPermissionStatus = {
  accessibility: boolean
  screenRecording: boolean
  eventPosting: boolean
  permissionTarget: string
}

export type ComputerPermissionKey = 'accessibility' | 'screenRecording' | 'eventPosting'
