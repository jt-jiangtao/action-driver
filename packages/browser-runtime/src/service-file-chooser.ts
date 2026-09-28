import { randomUUID } from 'node:crypto'
import { securityPolicyError } from './service-preferences.js'
import type { BrowserCdp } from './service-cdp.js'
import type { CdpEvent } from './service-cdp-events.js'
interface Chooser {
  tabId: number
  backendNodeId: number
  isMultiple: boolean
}
interface ChooserContext {
  cdp: Pick<BrowserCdp, 'call' | 'waitForEvent'> & {
    fileChoosersById: Map<string, { tabId: number; [key: string]: unknown }>
  }
  security: { ensureFileUploadAllowed(id: number): Promise<unknown> }
  clientInfo?: { family?: string }
}
const positive = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
function tabId(value: number | string) {
  const result = Number(value)
  if (!positive(result)) throw Error('Expected a positive integer')
  return result
}
const isChooser = (event: CdpEvent) =>
  event.method === 'Page.fileChooserOpened' && positive(event.params?.backendNodeId)
function chooser(id: number, event: CdpEvent): Chooser {
  const params = event.params
  if (!positive(params?.backendNodeId))
    throw Error('File chooser event did not include a backend node id')
  if (event.source.tabId != null && event.source.tabId !== id)
    throw Error('File chooser event belongs to a different tab')
  if (event.source.sessionId != null || event.source.targetId != null)
    throw securityPolicyError('File uploads in out-of-process frames are not supported.')
  return {
    backendNodeId: params!.backendNodeId as number,
    isMultiple: params?.mode === 'selectMultiple',
    tabId: id
  }
}
export async function waitForFileChooser(
  params: { tab_id: number | string; timeout_ms?: number },
  context: ChooserContext
) {
  const id = tabId(params.tab_id),
    timeoutMs = Math.min(
      Math.max(0, typeof params.timeout_ms === 'number' ? params.timeout_ms : 3000),
      120000
    )
  try {
    const event = await context.cdp.waitForEvent(id, isChooser, {
      timeoutMs,
      timeoutMessage: `Timed out after ${timeoutMs}ms waiting for file chooser.`,
      action: async () => {
        await context.cdp.call(id, 'Page.enable')
        await context.cdp.call(id, 'Page.setInterceptFileChooserDialog', { enabled: true })
      }
    })
    // The predicate cannot resolve successfully without an event.
    if (event == null) throw Error('File chooser event did not include a backend node id')
    const key = randomUUID(),
      value = chooser(id, event)
    context.cdp.fileChoosersById.set(key, { ...value })
    return { file_chooser_id: key, is_multiple: value.isMultiple }
  } finally {
    await context.cdp
      .call(id, 'Page.setInterceptFileChooserDialog', { enabled: false })
      .catch(() => {})
  }
}
function notAllowed(error: unknown) {
  const message =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error !== null && 'message' in error
        ? error.message
        : undefined
  if (message === 'Not allowed') return true
  if (typeof message !== 'string') return false
  try {
    const value = JSON.parse(message)
    return (
      value != null &&
      typeof value === 'object' &&
      value.code === -32000 &&
      value.message === 'Not allowed'
    )
  } catch {
    return false
  }
}
export async function setFileChooserFiles(
  params: { tab_id: number | string; file_chooser_id: string; files: string[] },
  context: ChooserContext
) {
  const id = tabId(params.tab_id),
    value = context.cdp.fileChoosersById.get(params.file_chooser_id)
  if (value == null) throw Error(`Unknown file chooser id "${params.file_chooser_id}"`)
  if (value.tabId !== id)
    throw Error(`File chooser "${params.file_chooser_id}" belongs to tab ${value.tabId}`)
  if (params.files.length === 0) throw Error('fileChooser.setFiles requires at least one file')
  if (!value.isMultiple && params.files.length > 1)
    throw Error('File chooser does not accept multiple files')
  await context.security.ensureFileUploadAllowed(id)
  try {
    await context.cdp.call(id, 'DOM.setFileInputFiles', {
      backendNodeId: value.backendNodeId,
      files: params.files
    })
  } catch (error) {
    if (notAllowed(error)) {
      const family = context.clientInfo?.family ?? 'chrome',
        names: Record<string, string> = {
          chrome: 'Google Chrome',
          edge: 'Microsoft Edge',
          brave: 'Brave',
          opera: 'Opera',
          vivaldi: 'Vivaldi'
        }
      throw Error(
        `To enable file upload, go to ${family}://extensions in ${names[family]}, click Details under the ChatGPT extension, and enable "Allow access to file URLs." See [here](https://developers.openai.com/codex/app/chrome-extension#upload-files) for details.`
      )
    }
    throw error
  }
  context.cdp.fileChoosersById.delete(params.file_chooser_id)
  return {}
}
