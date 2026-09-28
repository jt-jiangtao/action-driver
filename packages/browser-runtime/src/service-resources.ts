import { readFile } from 'node:fs/promises'
import type { DocumentationManifest, DocumentEntry } from './service-documentation.js'
export interface BrowserResourceSet {
  apiManifest: DocumentationManifest
  documentManifest: DocumentEntry[]
  documentation: Record<string, string>
}
interface BrowserResources {
  default: BrowserResourceSet
  environments?: Record<string, BrowserResourceSet>
}
export interface ResourceFilesystem {
  readFile(url: URL): Promise<string>
}
interface ResourceOptions {
  root?: URL
  environment?: string | undefined
}
let resource: Promise<BrowserResources> | undefined
export async function browserResources(environment?: string) {
  const data = await (resource ??= readFile(
    new URL('../resources/browser-documentation.json', import.meta.url),
    'utf8'
  ).then((text) => JSON.parse(text) as BrowserResources))
  if (environment == null || data.environments == null) return data.default
  const selected = data.environments[environment]
  if (!selected)
    throw Error(`Browser documentation is not packaged for environment: ${environment}`)
  return selected
}
async function readOverride(name: string, filesystem: ResourceFilesystem | undefined, root: URL) {
  if (!filesystem) throw Error('Browser documentation filesystem is required for an explicit root')
  return filesystem.readFile(new URL(name, root))
}
export async function readBrowserDocument(
  name: string,
  filesystem?: ResourceFilesystem,
  options: ResourceOptions = {}
): Promise<string> {
  if (typeof name !== 'string' || !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/u.test(name))
    throw Error('Documentation name must be a relative path without an extension.')
  if (options.root) return readOverride(`${name}.md`, filesystem, options.root)
  const data = await browserResources(options.environment),
    text = data.documentation[name]
  if (typeof text !== 'string') throw Error(`Documentation is not available: ${name}`)
  return text
}
export async function readApiManifest(
  filesystem?: ResourceFilesystem,
  options: ResourceOptions = {}
): Promise<DocumentationManifest> {
  if (options.root) return JSON.parse(await readOverride('api.json', filesystem, options.root))
  return (await browserResources(options.environment)).apiManifest
}
export async function readDocumentManifest(
  filesystem?: ResourceFilesystem,
  options: ResourceOptions = {}
): Promise<DocumentEntry[]> {
  if (options.root)
    return JSON.parse(await readOverride('documents.json', filesystem, options.root))
  return (await browserResources(options.environment)).documentManifest
}
const overrideable = new Set([
  'api-use-behavior',
  'bootstrap-troubleshooting',
  'browser-troubleshooting',
  'capabilities/browser/viewport',
  'capabilities/browser/visibility',
  'capabilities/tab/botDetection',
  'capabilities/tab/browserAuth',
  'capabilities/tab/cdp',
  'capabilities/tab/pageAssets',
  'cloud-auth',
  'cloud-no-auth',
  'cloud-shared-files',
  'file-uploads',
  'screenshots',
  'visibility'
])
interface GuidanceHost {
  env: Record<string, string | undefined>
  gaas?: { browserConfig: { instruction_overrides?: Record<string, string> } }
}
export async function readBrowserGuidance(
  host: GuidanceHost,
  name: string,
  filesystem?: ResourceFilesystem,
  options: { environment?: string | undefined } = {}
): Promise<string> {
  let selected = name
  if (options.environment === 'orbit') {
    if (name === 'cloud-auth') selected = 'orbit-cloud-auth'
    else if (name === 'capabilities/tab/browserAuth') selected = 'capabilities/tab/orbitBrowserAuth'
  }
  if (overrideable.has(selected)) {
    const override = host.gaas?.browserConfig.instruction_overrides?.[selected]
    if (override?.trim()) return override
  }
  const text = await readBrowserDocument(selected, filesystem, options)
  if (
    options.environment === 'cloud' &&
    selected === 'capabilities/tab/browserAuth' &&
    host.env.BROWSER_USE_TINYSKY_ENABLED?.trim() === '1'
  )
    return text
      .replaceAll(
        /nodeRepl\.write\(await (\w+)\.dom_cua\.get_visible_dom\(\)\)/gu,
        'await $1.getAXState()'
      )
      .replaceAll('.dom_cua.get_visible_dom()', '.getAXState()')
      .replaceAll(
        'interactive structure across nested and cross-origin frames',
        'accessibility structure'
      )
      .replaceAll('visible-DOM inspection', 'accessibility inspection')
  return text
}
