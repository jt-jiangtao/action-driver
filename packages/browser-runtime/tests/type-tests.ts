import type { PlaywrightAPI } from '../src/playwright'
import type { PlaywrightLocator } from '../src/locator'
import type { PlaywrightDownload } from '../src/locator'
import type { PlaywrightFileChooser } from '../src/playwright'
declare const page: PlaywrightAPI
declare const locator: PlaywrightLocator
const text: Promise<string | null> = locator.evaluate((element) => element.textContent)
const texts: Promise<(string | null)[]> = locator.evaluateAll((elements) =>
  elements.map((element) => element.textContent)
)
const query: Promise<string> = page.evaluate((arg) => arg.query, { query: 'x' })
const asyncQuery: Promise<string> = page.evaluate(async (arg) => arg.query, { query: 'x' })
const download: Promise<PlaywrightDownload> = page.waitForEvent('download')
const chooser: Promise<PlaywrightFileChooser> = page.waitForEvent('filechooser')
void [text, texts, query, asyncQuery, download, chooser]
import type { AXAPI, ClipboardItem, TabClipboardAPI } from '../src/tab-apis'
import { decorateBrowserTab } from '../../cua/src/tab-adapter'
declare const ax: AXAPI
declare const clipboard: TabClipboardAPI
const axState: Promise<string> = ax.get()
const screenshot: Promise<Uint8Array> = ax.get('screenshot')
const observation: Promise<{ state: string; screenshot?: Uint8Array }> = ax.get('both')
const clipboardItems: Promise<ClipboardItem[]> = clipboard.read()
const decorated = decorateBrowserTab({ ax })
const decoratedState: Promise<string> = decorated.getAXState({ emit: false })
void [axState, screenshot, observation, clipboardItems, decoratedState]
import { Agent } from '../src/browser-agent'
import type { BrowserInfo } from '../src/browser-agent'
import type { AgentTransport } from '../src/transport'
import { TabsControls } from '../src/tab-collections'
declare const agentTransport: AgentTransport
const selectedAgent = new Agent({
  transport: agentTransport,
  createBrowser: ({ browserInfo }) => ({ id: browserInfo.id })
})
const selectedBrowser: Promise<{ id: string }> = selectedAgent.browsers.getDefault()
const browserList: Promise<BrowserInfo[]> = selectedAgent.browsers.list()
const agentDocs: Promise<string> = selectedAgent.documentation.get('browser')
const selectedTabs = new TabsControls({
  browserId: 'b',
  transport: agentTransport,
  createTab: async (payload) => ({ id: payload.id })
})
const createdTab: Promise<{ id: string }> = selectedTabs.new()
void [selectedBrowser, browserList, agentDocs, createdTab]
declare const listedBrowser: BrowserInfo
const listedName: string = listedBrowser.name
const listedType: 'iab' | 'extension' | 'cdp' = listedBrowser.type
void [listedName, listedType]

const asyncAgent = new Agent({
  transport: agentTransport,
  createBrowser: async ({ browserInfo }) => ({ id: browserInfo.id })
})
const asyncBrowser: Promise<{ id: string }> = asyncAgent.browsers.get('b')
const asyncDefaultBrowser: Promise<{ id: string }> = asyncAgent.browsers.getDefault()
const asyncUrlBrowser: Promise<{ id: string }> = asyncAgent.browsers.getForUrl('url')
const asyncSelectedTab: Promise<{ id: string } | undefined> = selectedTabs.selected()
const asyncGetTab: Promise<{ id: string }> = selectedTabs.get('t')
void [asyncBrowser, asyncDefaultBrowser, asyncUrlBrowser, asyncSelectedTab, asyncGetTab]

import { Capabilities, BrowserCapability, browserRegistration } from '../src/capabilities'
import { createApiView, disabledMembersForBrowser } from '../src/api-view'
const capabilityInfo = { id: 'example', description: 'example' }
const capability = new BrowserCapability(
  agentTransport,
  'b',
  { get: async () => 'docs' },
  capabilityInfo
)
const capabilityDocs: Promise<string> = capability.documentation()
const capabilityList: Promise<import('../src/capabilities').CapabilityInfo[]> = new Capabilities({
  example: capability
}).list()
const selectedCapability: Promise<BrowserCapability> = new Capabilities({
  example: capability
}).get('example')
class ExampleCapability {
  constructor(public options: import('../src/capabilities').BrowserCapabilityOptions) {}
}
const registration = browserRegistration({ capability: ExampleCapability, info: capabilityInfo })
const registeredCapability: ExampleCapability = registration.create({
  browserId: 'b',
  documentation: { get: async () => 'docs' },
  transport: agentTransport
})
const apiManifest = { interfaces: { ExampleCapability: {} } }
const apiView = createApiView(apiManifest, { ExampleCapability })
const visibleCapability: ExampleCapability = apiView(registeredCapability, new Set())
const disabledMembers: Set<string> = disabledMembersForBrowser(
  apiManifest,
  { type: 'iab' },
  new Set()
)
void [
  capabilityDocs,
  capabilityList,
  selectedCapability,
  registeredCapability,
  visibleCapability,
  disabledMembers
]

import { initializeBrowserRuntime } from '../src/runtime-initialization'
import type { RuntimeFactoryOptions } from '../src/runtime-initialization'
import { createBrowserService } from '../src/service-lifecycle'
const initializedRuntime: Promise<string> = initializeBrowserRuntime({}, async () => 'agent')
declare const runtimeFactoryOptions: RuntimeFactoryOptions
const runtimeEffect: Promise<void> = runtimeFactoryOptions.displaySideEffect('value')
const runtimeCommand: Promise<unknown> = runtimeFactoryOptions.executeAgentCommand({
  type: 'get_browser'
})
const runtimeDisabledMembers: Set<string> = runtimeFactoryOptions.disabledMemberIds
const serviceHandler = createBrowserService({
  prepareHost: async () => ({ id: 'host' }),
  createRuntime: async (_options, host) => ({
    apiManifest: { interfaces: {} },
    disabledMemberIds: new Set<string>(),
    executeAgentCommand: async (_input) => ({ hostId: host.id })
  })
})
const serviceSetup: Promise<unknown> = serviceHandler({
  method: 'setup',
  params: { environment: 'codex-app' }
})
const serviceExecution: Promise<unknown> = serviceHandler({
  method: 'execute',
  params: { type: 'list_browsers' }
})
void [
  initializedRuntime,
  runtimeEffect,
  runtimeCommand,
  runtimeDisabledMembers,
  serviceSetup,
  serviceExecution
]

import type { SessionBrowser, SessionTab } from '../../cua/src/browser-session'
import { TabControls } from '../src/tab-controls'
import { AXAPI as IntegratedAXAPI } from '../src/tab-apis'
class IntegratedTab extends TabControls {
  ax = new IntegratedAXAPI({ browserId: 'b', tabId: 't', transport: agentTransport })
}
const facadeTab: SessionTab = decorateBrowserTab(
  new IntegratedTab({ browserId: 'b', tabPayload: { id: 't' }, transport: agentTransport })
)
const integratedBrowser: SessionBrowser = {
  browserId: 'b',
  documentation: async () => 'docs',
  capabilities: { get: async () => ({ set: async () => {} }) },
  tabs: new TabsControls({ browserId: 'b', transport: agentTransport, createTab: () => facadeTab })
}
void [facadeTab, integratedBrowser]
import type { BrowserApiFactory } from '../src/api-factory'
import type { BrowserControls } from '../src/browser-controls'
declare const factoryTransport: AgentTransport
declare const factory: BrowserApiFactory<BrowserControls>
const factoryBrowser: BrowserControls = factory.createBrowser({
  browserInfo: { id: 'b', name: 'browser', type: 'iab' },
  onBrowserUsed: () => {},
  transport: factoryTransport
})
const factoryAgent: Agent<BrowserControls> = factory.createAgent({
  executeAgentCommand: async () => ({})
})
const factoryWrapped: BrowserControls = factory.wrapAgent(factoryBrowser)
void [factoryBrowser, factoryAgent, factoryWrapped]
import type { ComposedBrowser, ComposedTab } from '../src/composition'
declare const composed: ComposedBrowser
const composedTab: Promise<ComposedTab> = composed.tabs.get('t')
const claimedTab: Promise<ComposedTab> = composed.user.claimTab('t')
declare const composedInstance: ComposedTab
const composedCount: Promise<number> = composedInstance.playwright.getByRole('button').count()
const composedAX: Promise<string> = composedInstance.ax.get()
const composedDecorated = decorateBrowserTab(composedInstance)
const composedState: Promise<string> = composedDecorated.getAXState({ emit: false })
void [composedTab, claimedTab, composedCount, composedAX, composedState]
import { toWebMcpToolDescriptor, createWebMcpSnapshot } from '../src/webmcp-snapshot'
import type { WebMcpTool, WebMcpSnapshot } from '../src/webmcp-snapshot'
import { prepareBrowserAuthRequest } from '../src/browser-auth-request'
declare const webMcpTool: WebMcpTool
const toolDescriptorName: string = toWebMcpToolDescriptor(webMcpTool).name
const toolDescriptorSchema: unknown = toWebMcpToolDescriptor(webMcpTool).inputSchema
const toolSnapshot: Readonly<WebMcpSnapshot> = createWebMcpSnapshot({
  tools: [webMcpTool],
  context: { browserId: 'b', tabId: 't', transport: factoryTransport }
})
const toolCall: Promise<unknown> = toolSnapshot.call('alias', {})
const authPayload = prepareBrowserAuthRequest(
  {
    origin: 'https://example.test',
    fields: [{ id: 'field', label: 'Field', type: 'text', required: true, selector: locator }]
  },
  { browserId: 'b', tabId: 't' }
)
const authSelector: string = authPayload.fields[0]!.selector
void [toolDescriptorName, toolDescriptorSchema, toolSnapshot, toolCall, authSelector]
import type { CdpTabCapability } from '../src/cdp-capability'
import type { CdpSendOptions } from '../src/cdp-capability'
declare const cdpCapability: CdpTabCapability
const cdpOptions: CdpSendOptions = { target: { sessionId: 'session' }, timeoutMs: 100 }
const cdpResult: Promise<unknown> = cdpCapability.send(
  'Runtime.evaluate',
  { expression: '1' },
  cdpOptions
)
const cdpDocs: Promise<string> = cdpCapability.documentation()
const cdpId: string = cdpCapability.id
void [cdpOptions, cdpResult, cdpDocs, cdpId]

import { AtlasCommand } from '../src/command'
const command = new AtlasCommand('test', { parse: (_input: unknown) => ({ value: 1 }) }, {})
const parsedCommand: { value: number } = command.parse()
const serializedCommand: Record<string, unknown> = command.toJSON()
void [parsedCommand, serializedCommand]

import type { SessionBrowserApi } from '../src/service-backend-api'
import { BrowserCdp } from '../src/service-cdp'
import { ServiceTabs, BrowserUi } from '../src/service-tabs'
import { dispatchKeys } from '../src/service-keyboard-input'
declare const sessionApi: SessionBrowserApi
declare const serviceSpan: import('../src/service-cdp-execution').CdpPerformanceSpan
const serviceCdp = new BrowserCdp(sessionApi, 'darwin', serviceSpan)
const serviceTabs = new ServiceTabs(sessionApi)
const serviceUi = new BrowserUi(sessionApi)
const serviceKeys: Promise<void> = dispatchKeys(serviceCdp, 1, ['Meta', 'a'])
void [serviceTabs, serviceUi, serviceKeys]

const documentReady: string | undefined = (await serviceCdp.readDocumentState(1))?.readyState
void documentReady
