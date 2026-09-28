import { disabledMembersForBrowser } from './api-view.js'
import { browserCapabilityDefinitions, tabCapabilityDefinitions } from './capability-registry.js'
import type { ApiManifest } from './api-view.js'
import type { CapabilityInfo } from './capabilities.js'
export interface ApiDeclaration {
  text: string
  references: string[]
  documented?: boolean
  unsupportedByDefaultIn?: string[]
}
interface ApiMember {
  declarations: ApiDeclaration[]
  documented?: boolean
  unsupportedByDefaultIn?: string[]
}
export interface DocumentationManifest extends ApiManifest {
  root: string
  interfaces: Record<string, Record<string, ApiMember>>
  types: Record<string, { text: string; references: string[] }>
}
export interface DocumentEntry {
  name: string
  mode: 'included' | 'lookup' | 'model'
  description?: string
  requiredFor?: string[]
  when?: {
    browserTypes?: string[]
    requiredApiMembers?: string[]
    requiredBrowserCapabilities?: string[]
    excludedTabCapabilities?: string[]
    requiredTabCapabilities?: string[]
  }
}
export interface DocumentationBrowserInfo {
  id: string
  name: string
  type: string
  capabilities: { browser?: CapabilityInfo[]; tab?: CapabilityInfo[] }
  apiSupportOverrides?: Record<string, boolean | null | undefined> | undefined
}
interface DocumentationOptions {
  apiManifest: DocumentationManifest
  documentManifest: DocumentEntry[]
  disabledMemberIds: Set<string>
  undocumentedApiMembers?: string[]
  excludedDocumentation?: string[]
  addendum?: string
  readDocumentation(name: string): Promise<string>
}
function declarations(
  name: string,
  members: Record<string, ApiMember>,
  type: string,
  disabled: Set<string>
) {
  return Object.entries(members).flatMap(([key, member]) =>
    disabled.has(`${name}.${key}`) || member.documented === false
      ? []
      : member.declarations.filter(
          (item) =>
            item.documented !== false && item.unsupportedByDefaultIn?.includes(type) !== true
        )
  )
}
export function renderApiReference(
  manifest: DocumentationManifest,
  type: string,
  disabled = new Set<string>()
): string {
  const visited = new Set<string>(),
    pending = [manifest.root]
  for (const name of pending) {
    if (visited.has(name)) continue
    const member = manifest.interfaces[name],
      value = manifest.types[name]
    let references: string[]
    if (member)
      references = declarations(name, member, type, disabled).flatMap((item) => item.references)
    else if (value) references = value.references
    else continue
    visited.add(name)
    for (const reference of references) if (!visited.has(reference)) pending.push(reference)
  }
  const lines = [
    '# API Reference',
    '',
    'Use this as the supported `agent.browsers.*` surface.',
    '',
    '```ts',
    '// Returned by setupBrowserRuntime().',
    '// browser was selected during bootstrap.'
  ]
  for (const [name, members] of Object.entries(manifest.interfaces))
    if (visited.has(name))
      lines.push(
        `interface ${name} {`,
        ...declarations(name, members, type, disabled).map((item) => `  ${item.text}`),
        '}',
        ''
      )
  for (const [name, value] of Object.entries(manifest.types))
    if (visited.has(name)) lines.push(value.text, '')
  lines[lines.length - 1] = '```'
  return lines.join('\n').trim() + '\n'
}
function applicable(
  entries: DocumentEntry[],
  browser: DocumentationBrowserInfo,
  disabled: Set<string>
) {
  const browserIds = new Set(browser.capabilities?.browser?.map((item) => item.id) ?? []),
    tabIds = new Set(browser.capabilities?.tab?.map((item) => item.id) ?? [])
  return entries.filter(
    ({ when }) =>
      !(
        when?.browserTypes?.includes(browser.type) === false ||
        when?.requiredApiMembers?.some((id) => disabled.has(id)) === true ||
        when?.requiredBrowserCapabilities?.some((id) => !browserIds.has(id)) === true ||
        when?.excludedTabCapabilities?.some((id) => tabIds.has(id)) === true ||
        when?.requiredTabCapabilities?.some((id) => !tabIds.has(id)) === true
      )
  )
}
function capabilityDocs(surface: 'browser' | 'tab', items: CapabilityInfo[] | undefined) {
  const definitions =
      surface === 'browser' ? browserCapabilityDefinitions : tabCapabilityDefinitions,
    byId = new Map(definitions.map((item) => [item.id, item.info]))
  const lines = (items ?? []).flatMap(({ id }) => {
    const info = byId.get(id)
    return info
      ? [
          `- \`${id}\`: ${info.description}\n  Read with \`await (await ${surface}.capabilities.get("${id}")).documentation()\`.`
        ]
      : []
  })
  return [
    `## ${surface === 'browser' ? 'Browser' : 'Tab'} Capabilities`,
    ...(lines.length ? lines : ['- None'])
  ].join('\n')
}
export class BrowserDocumentation {
  options: DocumentationOptions
  readNames = new Set<string>()
  constructor(options: DocumentationOptions) {
    this.options = options
  }
  async read(name: string) {
    if (!this.options.documentManifest.some((item) => item.name === name))
      throw new Error(`Documentation is not available: ${name}`)
    const value = await this.options.readDocumentation(name)
    this.readNames.add(name)
    return value
  }
  async readBrowser(browser: DocumentationBrowserInfo) {
    const { apiManifest, disabledMemberIds, documentManifest } = this.options
    const disabled = disabledMembersForBrowser(apiManifest, browser, disabledMemberIds)
    for (const name of this.options.undocumentedApiMembers ?? []) disabled.add(name)
    const selected = applicable(documentManifest, browser, disabled),
      included = selected.filter((item) => item.mode === 'included').map((item) => item.name),
      lookup = selected.filter((item) => item.mode === 'lookup')
    const guidance = await Promise.all(
      included
        .filter((name) => !this.options.excludedDocumentation?.includes(name))
        .map(this.options.readDocumentation)
    )
    const identity = [
      '# Selected Browser',
      `- Name: ${browser.name}`,
      `- Type: ${browser.type}`,
      `- ID: ${browser.id}`,
      'Reuse this browser binding across later turns. A new user turn or tab error does not invalidate it; select another browser only when the browser-selection policy requires it.',
      'If a tab is stale or missing later, obtain or create a fresh tab from this browser; never reselect a browser to recover a tab. Empty tab lists are normal after cleanup and do not invalidate this browser binding.'
    ].join('\n')
    const additional = [
      '# Additional Capabilities',
      capabilityDocs('browser', browser.capabilities.browser),
      capabilityDocs('tab', browser.capabilities.tab)
    ].join('\n')
    const text = [
      identity,
      ...guidance,
      lookup.length
        ? [
            '# Additional Documentation',
            'Use `await agent.documentation.get("<name>")` when you need one of these topics:',
            ...lookup.map((item) => `- \`${item.name}\`: ${item.description}`)
          ].join('\n')
        : undefined,
      additional,
      renderApiReference(apiManifest, browser.type, disabled),
      this.options.addendum
    ]
      .filter((item) => item != null)
      .join('\n\n')
    for (const name of included) this.readNames.add(name)
    return text
  }
  assertRequiredDocumentationRead(command: string) {
    const missing = this.options.documentManifest
      .filter(
        (item) => item.requiredFor?.includes(command) === true && !this.readNames.has(item.name)
      )
      .map((item) => item.name)
    if (missing.length)
      throw new Error(
        `Required documentation has not been read: ${missing.map((name) => JSON.stringify(name)).join(', ')}. Read the instructions with ${missing.map((name) => `await agent.documentation.get(${JSON.stringify(name)})`).join('; ')}.`
      )
  }
}
