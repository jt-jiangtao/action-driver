import type { WindowAppState } from './types.js'
export interface AppState {
  app: string
  screenshot: { url: string } | null
  text: string
}
/** Normalize service skyshots and deliver app-specific instructions once per identity. */
export async function windowResult(
  app: string,
  result: WindowAppState,
  delivered: Set<string>
): Promise<AppState> {
  const skyshot = result.skyshot
  if (skyshot == null) throw new Error('computer-use service did not return a screenshot')
  const url = skyshot.screenshot?.url
  if (url != null && typeof url !== 'string')
    throw new Error('computer-use service did not return a screenshot URL')
  if (typeof skyshot.text !== 'string')
    throw new Error('computer-use service did not return screenshot text')
  const instructions = result.appSpecificInstructions
  if (instructions != null && typeof instructions !== 'string')
    throw new Error('computer-use service returned invalid app-specific instructions')
  let text = skyshot.text
  if (instructions != null && instructions.length > 0) {
    const bundle =
      typeof result.app === 'object' &&
      result.app !== null &&
      typeof result.app.bundleIdentifier === 'string' &&
      result.app.bundleIdentifier.length > 0
        ? result.app.bundleIdentifier
        : undefined
    const identity =
      bundle ?? (typeof result.app === 'string' && result.app.length > 0 ? result.app : app)
    if (bundle !== 'com.apple.iWork.Numbers' && !delivered.has(identity)) {
      delivered.add(identity)
      text = `<app_specific_instructions>\n${instructions}\n</app_specific_instructions>\n${text}`
    }
  }
  return { app, screenshot: url == null || url.length === 0 ? null : { url }, text }
}
