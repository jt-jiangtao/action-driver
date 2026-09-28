import { readFile } from 'node:fs/promises'
export const documentationSources = [
  'confirmations',
  'core-cua-repl',
  'core-node-repl',
  'other-browser-apis',
  'owned-macos'
] as const
export type DocumentationSource = (typeof documentationSources)[number]
export interface DocumentationReader {
  readDocumentation(source: string): Promise<string>
  readComputerUseConfirmationPolicy(): Promise<string>
}
interface DocumentationOptions {
  root?: URL
  getRequestMeta?: () => unknown
}
export function createDocumentationReader(options: DocumentationOptions = {}): DocumentationReader {
  const root = options.root ?? new URL('../resources/docs/', import.meta.url)
  async function readDocumentation(source: string): Promise<string> {
    if (!documentationSources.includes(source as DocumentationSource))
      throw new Error(`Unknown documentation source: ${source}`)
    return readFile(new URL(`tinysky-alt-${source}.md`, root), 'utf8')
  }
  const getMeta = options.getRequestMeta ?? (() => undefined)
  async function readComputerUseConfirmationPolicy(): Promise<string> {
    const requestMeta = getMeta()
    const policies =
      requestMeta == null
        ? undefined
        : (requestMeta as Record<string, unknown>)['openai/confirmation_policies']
    const computer =
      typeof policies === 'object' && policies !== null && !Array.isArray(policies)
        ? (policies as Record<string, unknown>).computer_use
        : undefined
    return typeof computer === 'string' &&
      computer.trim() !== '' &&
      Buffer.byteLength(computer, 'utf8') <= 12000
      ? computer
      : readDocumentation('confirmations')
  }
  return { readDocumentation, readComputerUseConfirmationPolicy }
}
