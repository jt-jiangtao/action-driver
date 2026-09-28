// Shared Browser API exports. Reconstruction-only service acceptance remains a separate gate.
export { FunctionAgentTransport } from './transport.js'
export type { AgentCommand, AgentTransport, TransportRequest } from './transport.js'
export { displayValue, createDisplaySideEffect } from './display.js'
export type { DisplayBridge, RenderedValue } from './display.js'
export { isPlainObject, isRegExp, hasErrorMessage, generateRequestId } from './utilities.js'
export { PlaywrightLocator, PlaywrightFrameLocator, PlaywrightDownload } from './locator.js'
export type { TextMatcher, MatchOptions, TimeoutOptions, LocatorFilter } from './locator.js'
export { PlaywrightAPI, PlaywrightFileChooser } from './playwright.js'
export type { ClickOptions, CheckOptions } from './locator.js'
export type { Selection } from './locator-actions.js'
export { AXAPI, CUAAPI, DomCUAAPI, ContentAPI, TabClipboardAPI, TabDevAPI } from './tab-apis.js'
export type {
  AXMode,
  AXCaptureOptions,
  AXObservation,
  ClipboardEntry,
  ClipboardItem,
  LogLevel,
  TabLog
} from './tab-apis.js'
export { AlertDialog, BeforeUnloadDialog, ConfirmDialog, PromptDialog } from './dialogs.js'
export { Agent, Browsers, Documentation } from './browser-agent.js'
export type { BrowserInfo, BrowserFactoryOptions, CreateBrowserOptions } from './browser-agent.js'

export {
  Capabilities,
  BrowserCapability,
  TabCapability,
  browserRegistration,
  tabRegistration
} from './capabilities.js'
export type {
  CapabilityInfo,
  CapabilityDocumentation,
  Capability,
  BrowserCapabilityOptions,
  TabCapabilityOptions
} from './capabilities.js'
export { toWebMcpToolDescriptor } from './webmcp-snapshot.js'

export { AtlasCommand } from './command.js'
export type { PayloadParser } from './command.js'

export { ComposedBrowser as Browser, ComposedTab as Tab } from './composition.js'
export { TabsControls as Tabs, BrowserUserControls as BrowserUser } from './tab-collections.js'
export type { TabsContentOptions } from './tab-collections.js'
export { CdpTabCapability } from './cdp-capability.js'
export type {
  CdpTarget,
  CdpSendOptions,
  CdpEventOptions,
  CdpEventResult
} from './cdp-capability.js'
export {
  BotDetectionTabCapability,
  BrowserAuthTabCapability,
  PageAssetsTabCapability,
  TabWebMcpCapability
} from './tab-capabilities.js'
export {
  ManagementBrowserCapability,
  VisibilityBrowserCapability,
  ViewportBrowserCapability
} from './browser-capabilities.js'
export * from './capability-registry.js'
export { TabCdpCommands, TabBotDetectionCommands } from './commands/structured.js'
export { TabBrowserAuthCommands, TabPageAssetsCommands } from './commands/capability.js'
export {
  BrowserManagementCommands,
  BrowserVisibilityCommands,
  BrowserViewportCommands
} from './commands/browser-capability.js'

export { Commands } from './commands/index.js'
export { setupBrowserRuntime } from './default-runtime.js'
export type { RuntimeSetupOptions } from './runtime-initialization.js'
export { createGuardedBrowserHost } from './host-port.js'
export type { ActionDriverBrowserHost, BrowserHostSetup } from './host-port.js'
export { readApiManifest, readBrowserDocument } from './service-resources.js'
