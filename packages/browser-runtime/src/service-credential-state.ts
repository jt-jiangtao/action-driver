import type { CredentialCommandHost, CredentialGate } from './service-credential-command.js'
export const credentialDocumentMessage =
  'Browser observation is unavailable for a document containing native credentials. Navigate to a new document to continue.'
export const credentialResumeMessage =
  'Browser observation is unavailable because native credential state cannot be safely resumed. Start a new browser runtime to continue.'
const blocked = () => Error(credentialDocumentMessage)
interface NavigationEvent {
  source: { tabId: number; sessionId?: string; targetId?: string }
  method: string
  params: { frame?: { id: string; parentId?: string }; frameId?: string }
}
export interface CredentialCdp {
  call(
    tabId: number,
    method: string,
    params: undefined,
    options: { timeoutMs: number }
  ): Promise<{ frameTree: { frame: { id: string; loaderId: string } } }>
  on(event: 'event', listener: (event: NavigationEvent) => void): unknown
  on(event: 'tabDetached', listener: (tabId: number) => void): unknown
  removeListener(event: 'event', listener: (event: NavigationEvent) => void): unknown
  removeListener(event: 'tabDetached', listener: (tabId: number) => void): unknown
}
export class CredentialRegistry implements CredentialCommandHost {
  private entries = new Map<string, DocumentCredentialGate>()
  private commands = new Set<symbol>()
  private idle = new Set<() => void>()
  private unsafe = false
  private brokerInitialization: Promise<void> | undefined
  private brokerStatus: (() => Promise<boolean | undefined>) | undefined
  gates = () => [...this.entries.values()]
  isUnsafe = () => this.unsafe
  assertHealthy = () => {
    if (this.unsafe) throw Error(credentialResumeMessage)
  }
  get(id: string, cdp: CredentialCdp) {
    let gate = this.entries.get(id)
    if (gate === undefined) {
      gate = new DocumentCredentialGate(id, cdp, this)
      this.entries.set(id, gate)
    } else gate.rebind(cdp)
    return gate
  }
  beginCommand = () => {
    this.assertHealthy()
    if (this.gates().some((gate) => gate.protectionPending)) throw blocked()
    const token = Symbol()
    this.commands.add(token)
    return () => {
      this.commands.delete(token)
      if (this.commands.size === 0) for (const release of [...this.idle]) release()
    }
  }
  async waitIdle() {
    if (this.commands.size > 0)
      await new Promise<void>((resolve) => {
        const finish = () => {
          this.idle.delete(finish)
          resolve()
        }
        this.idle.add(finish)
      })
  }
  checkBroker = async () => {
    this.assertHealthy()
    if (this.brokerInitialization !== undefined) {
      await this.brokerInitialization
      if (!this.gates().some((gate) => gate.usedNativeCredentials)) await this.verifyBroker()
    }
  }
  private async verifyBroker() {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (
        (await Promise.race([
          this.brokerStatus?.(),
          new Promise<undefined>((resolve) => {
            timer = setTimeout(() => resolve(undefined), 3500)
          })
        ])) !== false
      )
        throw Error()
    } catch {
      this.unsafe = true
      throw Error(credentialResumeMessage)
    } finally {
      clearTimeout(timer)
    }
  }
  async initializeBroker(
    host: {
      env: Record<string, string | undefined>
      gaas?: {
        getNativeCredentialObservationStatus?: (session: string) => Promise<boolean | undefined>
      }
    },
    sessionId: string | undefined
  ) {
    if (
      host.gaas === undefined ||
      !(
        host.env.BROWSER_AUTH_BROKER_CREDENTIAL_BINDING_VERSION === '1' ||
        ['7', '8', '10'].includes(host.env.BROWSER_AUTH_BROKER_MANUAL_SAVE_BINDING_VERSION ?? '')
      )
    )
      return
    this.brokerInitialization ??= (async () => {
      try {
        if (
          host.env.ENABLE_BROWSER_SESSION_TAB_OWNERSHIP !== 'true' ||
          host.env.BROWSER_AUTH_BROKER_SOCKET_PATH !==
            '/run/codex-browser-auth/browser-auth-broker.sock' ||
          !sessionId ||
          sessionId.length > 256
        )
          throw Error()
        this.brokerStatus = () =>
          host.gaas?.getNativeCredentialObservationStatus?.(sessionId) ?? Promise.resolve(undefined)
        await this.verifyBroker()
      } catch {
        this.unsafe = true
        throw Error(credentialResumeMessage)
      }
    })()
    await this.brokerInitialization
  }
}
export class DocumentCredentialGate implements CredentialGate {
  private revision = 0
  private observationRevision = 0
  private used = false
  private pending = false
  private manualSavingTabs = new Set<number>()
  private ordinaryInteractionTabs = new Set<number>()
  private documents = new Map<number, Set<string>>()
  private permittedDocuments = new Map<number, string>()
  private mainFrameIds = new Map<number, string>()
  constructor(
    public browserId: string,
    private cdp: CredentialCdp,
    private registry: CredentialRegistry
  ) {}
  get epoch() {
    return this.revision
  }
  get observationEpoch() {
    return this.observationRevision
  }
  get usedNativeCredentials() {
    return this.used
  }
  get protectionPending() {
    return this.pending
  }
  rebind(cdp: CredentialCdp) {
    if (this.cdp !== cdp) {
      this.revision++
      this.invalidateDocuments()
      this.mainFrameIds.clear()
      this.cdp = cdp
    }
  }
  invalidateDocuments(tabId?: number) {
    if (tabId === undefined) {
      this.permittedDocuments.clear()
      this.ordinaryInteractionTabs.clear()
    } else this.permittedDocuments.delete(tabId)
    if (
      (tabId === undefined || !this.ordinaryInteractionTabs.has(tabId)) &&
      this.registry.gates().some((gate) => gate.usedNativeCredentials)
    )
      this.observationRevision++
  }
  bindNavigationEvents(cdp: CredentialCdp) {
    const event = (event: NavigationEvent) => {
      if (cdp !== this.cdp || event.source.sessionId != null || event.source.targetId != null)
        return
      const id = event.source.tabId
      if (
        event.method === 'Page.frameNavigated' &&
        event.params.frame?.parentId == null &&
        event.params.frame !== undefined
      ) {
        this.mainFrameIds.set(id, event.params.frame.id)
        this.invalidateDocuments(id)
      } else if (
        event.method === 'Page.frameStartedNavigating' &&
        this.mainFrameIds.get(id) === event.params.frameId
      )
        this.invalidateDocuments(id)
      else if (
        event.method === 'Page.navigatedWithinDocument' &&
        (this.mainFrameIds.get(id) == null || this.mainFrameIds.get(id) === event.params.frameId)
      )
        this.invalidateDocuments(id)
    }
    const detached = (id: number) => {
      if (cdp === this.cdp) {
        this.revision++
        this.mainFrameIds.delete(id)
        this.ordinaryInteractionTabs.delete(id)
        this.invalidateDocuments(id)
      }
    }
    cdp.on('event', event)
    cdp.on('tabDetached', detached)
    return () => {
      if (cdp === this.cdp) {
        this.revision++
        this.invalidateDocuments()
        this.mainFrameIds.clear()
      }
      cdp.removeListener('event', event)
      cdp.removeListener('tabDetached', detached)
    }
  }
  async protect(tabId: number, release?: () => void) {
    await this.protectDocument(tabId, release)
  }
  async protectManualSaving(tabId: number, release?: () => void) {
    await this.protectDocument(tabId, release)
    this.manualSavingTabs.add(tabId)
  }
  hasManualSavingTab(tabId: number) {
    return this.manualSavingTabs.has(tabId)
  }
  allowOrdinaryInteraction(tabId: number, epoch: number) {
    if (
      this.pending ||
      this.revision !== epoch ||
      !Number.isSafeInteger(tabId) ||
      tabId <= 0 ||
      !this.manualSavingTabs.has(tabId)
    )
      throw blocked()
    this.invalidateDocuments(tabId)
    this.manualSavingTabs.delete(tabId)
    this.ordinaryInteractionTabs.add(tabId)
  }
  private async protectDocument(tabId: number, release?: () => void) {
    if (this.pending) throw blocked()
    this.pending = true
    this.used = true
    this.revision++
    this.invalidateDocuments()
    for (const other of this.registry.gates())
      if (other !== this) {
        other.revision++
        other.invalidateDocuments()
      }
    try {
      release?.()
      await this.registry.waitIdle()
      const loader = await this.readLoader(tabId)
      if ([...this.documents.values()].reduce((total, set) => total + set.size, 0) >= 64)
        throw blocked()
      const documents = this.documents.get(tabId) ?? new Set<string>()
      documents.add(loader)
      this.documents.set(tabId, documents)
    } catch {
      throw blocked()
    } finally {
      this.pending = false
    }
  }
  permitNavigatedDocument(tabId: number, loader: string, epoch: number) {
    if (!this.used && !this.registry.gates().some((gate) => gate.usedNativeCredentials)) return
    if (
      this.pending ||
      this.revision !== epoch ||
      !Number.isSafeInteger(tabId) ||
      tabId <= 0 ||
      !loader ||
      this.documents.get(tabId)?.has(loader) === true
    )
      throw blocked()
    this.invalidateDocuments(tabId)
    this.permittedDocuments.set(tabId, loader)
  }
  async assertObservationAllowed(tabId: number, epoch?: number, selected = this.used) {
    const before = this.observationRevision,
      check = () => {
        if (
          this.pending ||
          this.observationRevision !== before ||
          (epoch !== undefined && epoch !== this.observationRevision)
        )
          throw blocked()
      }
    check()
    if (selected && !this.ordinaryInteractionTabs.has(tabId)) {
      const permitted = this.permittedDocuments.get(tabId)
      if (permitted === undefined) throw blocked()
      const loader = await this.readLoader(tabId)
      if (loader !== permitted || this.documents.get(tabId)?.has(loader) === true) throw blocked()
    }
    check()
  }
  assertRetainedObservationAllowed() {
    if (this.used) throw blocked()
  }
  async observe<T>(read: () => Promise<T>, tabId: number): Promise<T> {
    const finish = this.registry.beginCommand(),
      epoch = this.observationEpoch
    try {
      await this.assertObservationAllowed(tabId, epoch)
      let result: T
      try {
        result = await read()
      } catch (error) {
        await this.assertObservationAllowed(tabId, epoch)
        throw error
      }
      await this.assertObservationAllowed(tabId, epoch)
      return result
    } finally {
      finish()
    }
  }
  async readLoader(tabId: number, timeoutMs = 2000) {
    if (!Number.isSafeInteger(tabId) || tabId <= 0) throw blocked()
    try {
      const { frameTree } = await this.cdp.call(tabId, 'Page.getFrameTree', undefined, {
          timeoutMs
        }),
        { id, loaderId } = frameTree.frame
      if (typeof id !== 'string' || !id || typeof loaderId !== 'string' || !loaderId)
        throw blocked()
      this.mainFrameIds.set(tabId, id)
      return loaderId
    } catch {
      throw blocked()
    }
  }
}
