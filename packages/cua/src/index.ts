// Reconstructed CUA API. Product hosts use the narrow session entry to avoid legacy defaults.
export { mirrorMap } from './core/mirror-map.js'
export { UnreachableCaseError } from './core/unreachable-case-error.js'
export type * from './types/index.js'
export { getApps, getBrowserTabs, getState } from './discovery.js'
export { parseTabMention, getMentionedBrowserId } from './tab-reference.js'
export { createDocumentationReader } from './documentation.js'
export type { DocumentationReader, DocumentationSource } from './documentation.js'
export { createComputerSession } from './computer-session.js'
export type { MacComputer, SessionHost } from './computer-session.js'
export { decorateBrowserTab } from './tab-adapter.js'
export type { BrowserAX } from './tab-adapter.js'

export { createBrowserSession } from './browser-session.js'
export type {
  SessionTab,
  SessionBrowser,
  SessionBrowserInfo,
  SessionBrowsers
} from './browser-session.js'

export { createCUASession } from './session.js'
export type { CUASessionOptions } from './session.js'

export { createTinyskyAlt } from './default-runtime.js'
export { cua } from './legacy-default.js'
export { createDelayedAction, createLazyEvaluator, sleep, enumerate, invariant } from './core/declared-helpers.js'
