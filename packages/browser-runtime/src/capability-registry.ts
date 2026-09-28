import { browserRegistration, tabRegistration } from './capabilities.js'
import { CdpTabCapability } from './cdp-capability.js'
import {
  BotDetectionTabCapability,
  BrowserAuthTabCapability,
  PageAssetsTabCapability,
  TabWebMcpCapability
} from './tab-capabilities.js'
import {
  ManagementBrowserCapability,
  VisibilityBrowserCapability,
  ViewportBrowserCapability
} from './browser-capabilities.js'
export const cdpTabCapabilityDefinition = tabRegistration({
  capability: CdpTabCapability,
  info: {
    id: 'cdp',
    description:
      'Send raw Chrome DevTools Protocol commands and read debugger events through a supported tab for developer use cases.'
  }
})
export const botDetectionTabCapabilityDefinition = tabRegistration({
  capability: BotDetectionTabCapability,
  info: {
    id: 'botDetection',
    description:
      'Use when the current tab is blocked by bot detection, a failed CAPTCHA, a hard access denial, or a repeated challenge/login loop.'
  }
})
export const browserAuthTabCapabilityDefinition = tabRegistration({
  capability: BrowserAuthTabCapability,
  info: {
    id: 'browserAuth',
    description:
      'MUST read its documentation before the first interaction with any authentication or sign-in flow required for the task. Covers method selection, secure user-provided credentials, and post-authentication verification and recovery.'
  }
})
export const pageAssetsTabCapabilityDefinition = tabRegistration({
  capability: PageAssetsTabCapability,
  info: {
    id: 'pageAssets',
    description:
      'List assets already observed in the current page state and bundle selected assets into a temporary local artifact.'
  }
})
export const webMcpTabCapabilityInfo = {
  id: 'webmcp',
  description:
    'Fetch page-defined WebMCP tools bound to the current document, then call them through the returned object.'
}
export const webMcpTabCapabilityDefinition = tabRegistration({
  capability: TabWebMcpCapability,
  info: webMcpTabCapabilityInfo
})
export const managementBrowserCapabilityDefinition = browserRegistration({
  capability: ManagementBrowserCapability,
  info: {
    id: 'management',
    description:
      'Organize windows, tabs, tab groups, and bookmarks. Use only for user-requested browser organization.'
  }
})
export const visibilityBrowserCapabilityDefinition = browserRegistration({
  capability: VisibilityBrowserCapability,
  info: {
    id: 'visibility',
    description:
      "Use to show or hide the browser to the user, and to determine the browser's current visibility. Keep browser work in the background unless the user asks to see it or live viewing is useful. When the browser should be visible, call set(true)."
  }
})
export const viewportBrowserCapabilityDefinition = browserRegistration({
  capability: ViewportBrowserCapability,
  info: {
    id: 'viewport',
    description:
      'Controls an explicit browser viewport override for responsive or device-size testing. Use it when a task calls for specific dimensions or breakpoint validation; otherwise leave it unset so the browser uses its normal viewport. Reset temporary overrides before finishing unless the user asked to keep them.'
  }
})
export const tabCapabilityDefinitions = [
  cdpTabCapabilityDefinition,
  botDetectionTabCapabilityDefinition,
  browserAuthTabCapabilityDefinition,
  pageAssetsTabCapabilityDefinition,
  webMcpTabCapabilityDefinition
]
export const browserCapabilityDefinitions = [
  managementBrowserCapabilityDefinition,
  visibilityBrowserCapabilityDefinition,
  viewportBrowserCapabilityDefinition
]
export const tabCapabilityFactories = new Map(
  tabCapabilityDefinitions.map((definition) => [definition.id, definition.create])
)
export const browserCapabilityFactories = new Map(
  browserCapabilityDefinitions.map((definition) => [definition.id, definition.create])
)
