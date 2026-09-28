import {
  clipboardInstallScript,
  clipboardCleanupScript,
  clipboardResponseScript
} from './service-clipboard-page.js'
import type { CdpTarget } from './service-cdp-execution.js'
import type { CdpEvent } from './service-cdp-events.js'
export interface ClipboardEntry {
  mime_type: string
  text?: string
  base64?: string
}
export interface ClipboardItemWire {
  entries: ClipboardEntry[]
  presentation_style?: 'unspecified' | 'inline' | 'attachment'
}
interface ClipboardCdp {
  callTarget(target: CdpTarget, method: string, params: Record<string, unknown>): Promise<unknown>
  on(event: string, handler: (event: any) => void): unknown
  removeListener(event: string, handler: (event: any) => void): unknown
  addTabCleanupHandler(handler: (id: number) => Promise<void>): () => void
}
interface Installed {
  bindingName: string
  identifier?: string
  target: CdpTarget
}
interface Installation {
  bindingName: string
  invalidated: boolean
  installation: Promise<Installed>
  cleanup?: Promise<void>
}
const key = (target: CdpTarget) =>
  target.sessionId != null
    ? `${target.tabId}:session:${target.sessionId}`
    : target.targetId != null
      ? `${target.tabId}:target:${target.targetId}`
      : `${target.tabId}:`
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object'
export function normalizeClipboardItems(value: unknown, command: string): ClipboardItemWire[] {
  if (!Array.isArray(value) || value.length === 0) throw Error(`${command} requires items`)
  return value.map((item) => {
    if (!record(item) || !Array.isArray(item.entries) || item.entries.length === 0)
      throw Error(`${command} requires clipboard item entries`)
    if (
      item.presentation_style != null &&
      !['unspecified', 'inline', 'attachment'].includes(item.presentation_style as string)
    )
      throw Error(`${command} requires a valid presentation_style`)
    const entries: ClipboardEntry[] = item.entries.map((entry: unknown) => {
      if (!record(entry) || typeof entry.mime_type !== 'string' || entry.mime_type.length === 0)
        throw Error(`${command} requires entry mime_type`)
      if (typeof entry.text === 'string' && typeof entry.base64 !== 'string')
        return { mime_type: entry.mime_type, text: entry.text }
      if (typeof entry.base64 === 'string' && typeof entry.text !== 'string') {
        try {
          atob(entry.base64)
        } catch {
          throw Error(`${command} requires valid base64 entry data`)
        }
        return { mime_type: entry.mime_type, base64: entry.base64 }
      }
      throw Error(`${command} requires exactly one of entry text or base64`)
    })
    return {
      entries,
      ...(item.presentation_style == null
        ? {}
        : {
            presentation_style: item.presentation_style as ClipboardItemWire['presentation_style']
          })
    } as ClipboardItemWire
  })
}
export class ServiceClipboard {
  items: ClipboardItemWire[] = []
  operationTail: Promise<void> = Promise.resolve()
  bridge: PageClipboardBridge | undefined
  disposed = false
  async ensurePageClipboard(cdp: ClipboardCdp, target: CdpTarget) {
    if (this.disposed) throw Error('Browser Use clipboard is disposed')
    this.bridge ??= new PageClipboardBridge(cdp, this)
    await this.bridge.ensure(target)
  }
  async cleanupPageClipboards() {
    await this.bridge?.cleanup()
  }
  runExclusive<T>(run: () => Promise<T>) {
    const result = this.operationTail.then(run)
    this.operationTail = result.then(
      () => {},
      () => {}
    )
    return result
  }
  read() {
    return this.items.map((item) => ({
      entries: item.entries.map((entry) => ({ ...entry })),
      ...(item.presentation_style == null ? {} : { presentation_style: item.presentation_style })
    }))
  }
  write(items: unknown, command: string) {
    this.items = normalizeClipboardItems(items, command)
  }
  async dispose() {
    this.disposed = true
    await this.bridge?.dispose()
    this.bridge = undefined
    this.items = []
  }
}
export class PageClipboardBridge {
  installations = new Map<string, Installation>()
  private removeTabCleanupHandler: () => void
  private disposal: Promise<void> | undefined
  constructor(
    private cdp: ClipboardCdp,
    private clipboard: ServiceClipboard
  ) {
    cdp.on('event', this.handleCdpEvent)
    cdp.on('tabDetached', this.handleTabDetached)
    this.removeTabCleanupHandler = cdp.addTabCleanupHandler(async (id) => this.cleanupTab(id))
  }
  async ensure(target: CdpTarget): Promise<void> {
    if (this.disposal !== undefined) throw Error('Browser Use clipboard bridge is disposed')
    const id = key(target)
    let installation = this.installations.get(id)
    if (installation === undefined) {
      const bindingName = `__browserUseClipboard_${crypto.randomUUID().replaceAll('-', '')}`
      installation = {
        bindingName,
        invalidated: false,
        installation: this.install(target, bindingName)
      }
      this.installations.set(id, installation)
    }
    try {
      await installation.installation
    } catch (error) {
      if (installation.cleanup === undefined && this.installations.get(id) === installation)
        this.installations.delete(id)
      if (installation.invalidated && this.disposal === undefined) {
        await installation.cleanup
        await this.ensure(target)
        return
      }
      throw error
    }
    if (this.disposal !== undefined) throw Error('Browser Use clipboard bridge is disposed')
    if (installation.invalidated || installation.cleanup !== undefined) {
      await this.cleanupInstallation(id, installation)
      await this.ensure(target)
    }
  }
  dispose() {
    if (this.disposal !== undefined) return this.disposal
    this.disposal = this.cleanup()
    this.cdp.removeListener('event', this.handleCdpEvent)
    this.cdp.removeListener('tabDetached', this.handleTabDetached)
    this.removeTabCleanupHandler()
    return this.disposal
  }
  async cleanup() {
    await Promise.all(
      [...this.installations].map(([id, installation]) =>
        this.cleanupInstallation(id, installation)
      )
    )
  }
  handleCdpEvent = (event: CdpEvent) => {
    if (event.method !== 'Runtime.bindingCalled') return
    const installation = this.installations.get(key(event.source))
    if (
      installation === undefined ||
      installation.cleanup !== undefined ||
      event.params?.name !== installation.bindingName
    )
      return
    this.handleBindingCall(
      event.source,
      event.params.executionContextId as number,
      event.params.payload as string
    )
  }
  handleTabDetached = (id: number) => {
    for (const [target, installation] of this.installations)
      if (target.startsWith(`${id}:`)) installation.invalidated = true
  }
  handleBindingCall(target: CdpTarget, contextId: number, payload: string) {
    let request: unknown
    try {
      request = JSON.parse(payload)
    } catch {
      return
    }
    if (!record(request) || typeof request.id !== 'number' || !Number.isSafeInteger(request.id))
      return
    const id = request.id
    let response: Record<string, unknown>
    try {
      if (!('operation' in request)) throw Error('Clipboard request is missing an operation')
      switch (request.operation) {
        case 'read':
          response = { id, items: this.clipboard.read(), ok: true }
          break
        case 'write':
          if (!('items' in request) || !Array.isArray(request.items))
            throw Error('Clipboard write requires items')
          this.clipboard.write(request.items, 'navigator.clipboard.write')
          response = { id, ok: true }
          break
        default:
          throw Error('Unsupported clipboard operation')
      }
    } catch (error) {
      response = { error: error instanceof Error ? error.message : String(error), id, ok: false }
    }
    void this.cdp
      .callTarget(target, 'Runtime.evaluate', {
        contextId,
        expression: clipboardResponseScript(response),
        returnByValue: true
      })
      .catch(() => {})
  }
  async install(target: CdpTarget, bindingName: string): Promise<Installed> {
    const source = clipboardInstallScript(bindingName)
    let bound = false,
      identifier: string | undefined
    try {
      await this.cdp.callTarget(target, 'Runtime.addBinding', { name: bindingName })
      bound = true
      identifier = (
        (await this.cdp.callTarget(target, 'Page.addScriptToEvaluateOnNewDocument', {
          runImmediately: true,
          source
        })) as { identifier?: string }
      ).identifier
      const check = (await this.cdp.callTarget(target, 'Runtime.evaluate', {
        expression: `globalThis.__browserUseClipboardBridge?.bindingName === ${JSON.stringify(bindingName)}`,
        returnByValue: true
      })) as { result?: { value?: unknown } }
      if (check.result?.value !== true)
        throw Error('Browser Use clipboard bridge installation failed')
      return identifier == null ? { bindingName, target } : { bindingName, identifier, target }
    } catch (error) {
      if (bound)
        await this.cleanupTarget(
          identifier == null ? { bindingName, target } : { bindingName, identifier, target }
        )
      throw error
    }
  }
  async cleanupTab(id: number) {
    await Promise.all(
      [...this.installations]
        .filter(([target]) => target.startsWith(`${id}:`))
        .map(([target, installation]) => this.cleanupInstallation(target, installation))
    )
  }
  cleanupInstallation(id: string, installation: Installation) {
    installation.cleanup ??= installation.installation
      .then(
        (installed) => this.cleanupTarget(installed),
        () => {}
      )
      .finally(() => {
        if (this.installations.get(id) === installation) this.installations.delete(id)
      })
    return installation.cleanup
  }
  async cleanupTarget({ bindingName, identifier, target }: Installed) {
    await this.cdp
      .callTarget(target, 'Runtime.evaluate', {
        expression: clipboardCleanupScript(bindingName),
        returnByValue: true
      })
      .catch(() => {})
    if (identifier != null)
      await this.cdp
        .callTarget(target, 'Page.removeScriptToEvaluateOnNewDocument', { identifier })
        .catch(() => {})
    await this.cdp
      .callTarget(target, 'Runtime.removeBinding', { name: bindingName })
      .catch(() => {})
  }
}
