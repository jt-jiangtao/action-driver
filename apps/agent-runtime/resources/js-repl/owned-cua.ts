import { createCUASession } from '@action-driver/cua/computer'
import { createProductSky } from '@action-driver/sky/action-driver'
import { setupBrowserDesktop } from '@action-driver/browser-desktop'
import { readApiManifest, readBrowserDocument } from '@action-driver/browser-runtime'
import { randomUUID } from 'node:crypto'
import type { ComputerHelperRequest } from '@action-driver/runtime-contracts'

export function createOwnedCua(
  request: (input: ComputerHelperRequest) => Promise<unknown>,
  browserRequest: (input: Record<string, unknown>) => Promise<unknown>,
  host: {
    env: Record<string, string>
    write(value: unknown): void
    emitImage(image: { bytes: Uint8Array; mimeType: string }): void
  }
) {
  const supported = new Set([
    'Agent.browsers', 'Agent.documentation', 'Documentation.get',
    'Browsers.list', 'Browsers.get', 'Browsers.getDefault',
    'Browsers.getForUrl', 'Browser.browserId', 'Browser.tabs', 'Browser.user',
    'Browser.documentation',
    'BrowserUser.openTabs', 'BrowserUser.claimTab', 'Tabs.new', 'Tabs.list',
    'Tabs.get', 'Tabs.selected', 'Tab.id', 'Tab.goto', 'Tab.back', 'Tab.forward',
    'Tab.reload', 'Tab.close',
    'Tab.screenshot', 'Tab.title', 'Tab.url', 'Tab.cua', 'Tab.ax', 'AXAPI.get',
    'CUAAPI.click', 'CUAAPI.double_click', 'CUAAPI.move', 'CUAAPI.drag',
    'CUAAPI.keypress', 'CUAAPI.scroll', 'CUAAPI.type'
  ])
  return setupBrowserDesktop({
    environment: 'codex-app',
    decorateTab(tab) {
      const candidate = tab as { ax: { get(mode: 'state', options: {
        disableDiffing: boolean
      }): Promise<string> }; getAXState?: (options: { disableDiffing: boolean }) => Promise<string> }
      candidate.getAXState = (options) => candidate.ax.get('state', options)
    },
    host: {
      async setup() {
        const apiManifest = await readApiManifest(undefined, { environment: 'training' })
        const disabledMemberIds = Object.entries(apiManifest.interfaces)
          .flatMap(([name, members]) => Object.keys(members).map((member) => `${name}.${member}`))
          .filter((id) => !supported.has(id))
        return { apiManifest, disabledMemberIds }
      },
      execute: async (command) => {
        if (command.type === 'get_documentation') {
          await browserRequest(command)
          return readBrowserDocument(String(command.name), undefined, { environment: 'training' })
        }
        return browserRequest(command)
      },
      displayImage: (bytes) => host.emitImage({ bytes, mimeType: 'image/png' }),
      async close() {}
    }
  }).then((agent) => createCUASession({
    agent,
    computer: createProductSky({ request }, { sessionId: randomUUID() }),
    getHost: () => host
  }))
}
