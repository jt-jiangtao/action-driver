import { TabsContent, BrowserUserGetTabContext } from './commands/structured.js'
import { decodeBase64 } from './tab-apis.js'
import type { z } from 'zod/v3'
import type { AgentTransport } from './transport.js'
import { dispatch } from './protocol.js'
export interface TabSummary {
  [key: string]: unknown
  id: string
  providerTabId?: string
  title?: string
  url?: string
}
export interface UserTabSummary extends TabSummary {
  lastOpened?: string
  tabGroup?: string
}
export interface TabPayload extends TabSummary {
  [key: string]: unknown
}
interface Options<T> {
  browserId: string
  createTab: (payload: TabPayload) => T
  transport: AgentTransport
}
/** Tabs collection core. Includes explicitly validated batch content requests. */
export class TabsControls<T = unknown> {
  #id: string
  #create: Options<T>['createTab']
  #transport: AgentTransport
  constructor({ browserId, createTab, transport }: Options<T>) {
    this.#id = browserId
    this.#create = createTab
    this.#transport = transport
  }
  async new(): Promise<Awaited<T>> {
    return await this.#create(
      (await dispatch(this.#transport, 'create_tab', { browser_id: this.#id })) as TabPayload
    )
  }
  async selected(): Promise<Awaited<T> | undefined> {
    const payload = (await dispatch(this.#transport, 'selected_tab', {
      browser_id: this.#id
    })) as TabPayload
    if (payload.id) return await this.#create(payload)
  }
  async list() {
    return (
      (await dispatch(this.#transport, 'list_tabs', { browser_id: this.#id })) as {
        tabs: TabSummary[]
      }
    ).tabs
  }
  async content(options: TabsContentOptions) {
    const command = TabsContent.create({
      browser_id: this.#id,
      urls: options.urls,
      content_type: options.contentType,
      ...(options.timeoutMs === undefined ? {} : { timeout_ms: options.timeoutMs })
    })
    command.parse()
    if (options.urls.length === 0) return []
    return ((await this.#transport.send({ command })) as z.infer<typeof TabsContent.ResultSchema>)
      .results
  }
  async get(id: string): Promise<Awaited<T>> {
    if (!id) throw new Error('tabs.get requires a tab id')
    return await this.#create(
      (await dispatch(this.#transport, 'get_tab', {
        browser_id: this.#id,
        tab_id: id
      })) as TabPayload
    )
  }
}
export function userTabId(input: string | { id: string }, method: string): string {
  if (typeof input === 'string') {
    if (!input.length) throw new Error(`browser.user.${method} received an empty tab id`)
    return input
  }
  if (input && typeof input === 'object' && typeof input.id === 'string') return input.id
  throw new Error(
    `browser.user.${method} expects a tab returned by browser.user.openTabs() or a tab id`
  )
}
/** BrowserUser collection core. Includes schema-validated user context and document byte decoding. */
export class BrowserUserControls<T = unknown> {
  #id: string
  #create: Options<T>['createTab']
  #transport: AgentTransport
  constructor({ browserId, createTab, transport }: Options<T>) {
    this.#id = browserId
    this.#create = createTab
    this.#transport = transport
  }
  async openTabs() {
    return (
      (await dispatch(this.#transport, 'browser_user_open_tabs', { browser_id: this.#id })) as {
        tabs: UserTabSummary[]
      }
    ).tabs
  }
  async getTabContext(input: string | { id: string }) {
    const raw = await this.#transport.send({
      command: BrowserUserGetTabContext.create({
        browser_id: this.#id,
        tab_id: userTabId(input, 'getTabContext')
      })
    })
    const result = BrowserUserGetTabContext.ResultSchema.parse(raw)
    if (result.kind !== 'document') return result
    return {
      data: decodeBase64(result.dataBase64),
      fileName: result.fileName,
      kind: result.kind,
      mimeType: result.mimeType,
      title: result.title,
      url: result.url
    }
  }
  async claimTab(input: string | { id: string }): Promise<Awaited<T>> {
    const tab_id = userTabId(input, 'claimTab')
    return await this.#create(
      (await dispatch(this.#transport, 'browser_user_claim_tab', {
        browser_id: this.#id,
        tab_id
      })) as TabPayload
    )
  }
}

export interface TabsContentOptions {
  urls: string[]
  contentType: z.infer<typeof TabsContent.ContentTypeSchema>
  timeoutMs?: number | undefined
}
