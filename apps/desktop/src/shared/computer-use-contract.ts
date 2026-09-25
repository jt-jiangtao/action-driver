export const COMPUTER_PERMISSIONS_CHECK_CHANNEL = 'computer-use.permissions.check'
export const COMPUTER_PERMISSIONS_SETTINGS_CHANNEL = 'computer-use.permissions.open-settings'

export type ComputerPermissionStatus = {
  accessibility: boolean
  screenRecording: boolean
  eventPosting: boolean
  permissionTarget: string
}
