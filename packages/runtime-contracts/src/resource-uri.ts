import { z } from 'zod'

/**
 * Unified resource addressing. A URI only locates a resource: it never carries credentials, and
 * every operation re-authorizes against the authoritative task/session the caller actually holds.
 */
export const RESOURCE_URI_PREFIX = 'adr://v1/'
export const RESOURCE_URI_VERSION = 1
export const RESOURCE_MAX_URI_LENGTH = 512

export const RESOURCE_ERROR_CODES = [
  'RESOURCE_INVALID_URI',
  'RESOURCE_SCHEME_UNKNOWN',
  'RESOURCE_UNAUTHORIZED',
  'RESOURCE_NOT_FOUND',
  'RESOURCE_UNAVAILABLE',
  'RESOURCE_UNSUPPORTED',
  'RESOURCE_VERSION_CONFLICT',
  'RESOURCE_IMMUTABLE',
  'RESOURCE_CANCELLED',
  'RESOURCE_DEADLINE_EXCEEDED',
  'RESOURCE_GAP_DETECTED'
] as const
export type ResourceErrorCode = (typeof RESOURCE_ERROR_CODES)[number]

export class ResourceError extends Error {
  constructor(readonly code: ResourceErrorCode, message: string) {
    // Prefix the code so diagnostics keep the structured reason wherever logs flatten the class.
    super(`${code}: ${message}`)
    this.name = 'ResourceError'
  }
}

/**
 * Authority passed to providers. `taskId`/`sessionId`/`version` may also appear in a URI query
 * string; `pluginId` is an in-memory authority claim only (a plugin cannot name itself in a URI)
 * and is what plugin-owned resources compare against the owner segment of the resource id.
 */
export interface ResourceScope { taskId?: string; sessionId?: string; version?: string; pluginId?: string }
export interface ResourceReference { scheme: string; id: string; scope: ResourceScope }

/** Preserve stored file references when projecting them into resource URIs. */
export function legacyResourceUri(
  scheme: 'session-input' | 'generated-output',
  fileId: string,
  scope: ResourceScope
): string {
  if (!fileId) throw new ResourceError('RESOURCE_NOT_FOUND', 'A resource id is required')
  return formatResourceUri({ scheme, id: fileId, scope })
}

const schemePattern = /^[a-z][a-z0-9-]{0,31}$/
const scopePattern = /^[A-Za-z0-9._:-]{1,128}$/
const unreserved = /[A-Za-z0-9._~-]/
const queryKeys = ['task', 'session', 'version'] as const

function invalid(message: string): never {
  throw new ResourceError('RESOURCE_INVALID_URI', message)
}

/**
 * Percent escapes must be canonical: uppercase hex, and the decoded byte must not be an
 * unreserved character (which has a shorter literal form) nor a separator that would let an
 * identifier smuggle path structure past the URI check.
 */
function assertCanonicalPath(path: string): void {
  for (let index = 0; index < path.length; index += 1) {
    const character = path[index]!
    if (character === '%') {
      const escape = path.slice(index, index + 3)
      if (!/^%[0-9A-F]{2}$/.test(escape)) invalid(`Non-canonical escape ${escape}`)
      const byte = Number.parseInt(escape.slice(1), 16)
      const decoded = String.fromCharCode(byte)
      if (unreserved.test(decoded) || decoded === '/' || decoded === '\\' || byte <= 0x20 || byte === 0x7f) invalid(`Non-canonical escape ${escape}`)
      index += 2
      continue
    }
    if (!/[A-Za-z0-9._~/-]/.test(character)) invalid(`Illegal character ${character}`)
  }
}

export function formatResourceUri(reference: ResourceReference): string {
  if (!schemePattern.test(reference.scheme)) invalid(`Invalid scheme ${reference.scheme}`)
  if (!reference.id || reference.id.length > 256) invalid('Invalid resource id')
  assertCanonicalPath(reference.id)
  for (const segment of reference.id.split('/')) if (!segment || segment === '.' || segment === '..') invalid(`Invalid path segment ${segment}`)
  const query: string[] = []
  for (const key of queryKeys) {
    const value = key === 'task' ? reference.scope.taskId : key === 'session' ? reference.scope.sessionId : reference.scope.version
    if (value === undefined) continue
    if (!scopePattern.test(value)) invalid(`Invalid ${key} scope`)
    query.push(`${key}=${value}`)
  }
  const uri = `${RESOURCE_URI_PREFIX}${reference.scheme}/${reference.id}${query.length ? `?${query.join('&')}` : ''}`
  if (uri.length > RESOURCE_MAX_URI_LENGTH) invalid('Resource URI is too long')
  return uri
}

export function parseResourceUri(value: string): ResourceReference {
  if (typeof value !== 'string' || !value.startsWith(RESOURCE_URI_PREFIX)) invalid('Unsupported resource URI prefix')
  if (value.length > RESOURCE_MAX_URI_LENGTH) invalid('Resource URI is too long')
  if (value.includes('#')) invalid('Resource URI must not carry a fragment')
  const rest = value.slice(RESOURCE_URI_PREFIX.length)
  const separator = rest.indexOf('?')
  const path = separator === -1 ? rest : rest.slice(0, separator)
  const rawQuery = separator === -1 ? undefined : rest.slice(separator + 1)
  const segments = path.split('/')
  const scheme = segments.shift() ?? ''
  const id = segments.join('/')
  if (!schemePattern.test(scheme)) invalid(`Invalid scheme ${scheme}`)
  if (!segments.length || !id) invalid('Resource id is required')
  assertCanonicalPath(id)
  for (const segment of segments) if (!segment || segment === '.' || segment === '..') invalid(`Invalid path segment ${segment}`)
  const scope: ResourceScope = {}
  if (rawQuery !== undefined) {
    if (!rawQuery) invalid('Empty resource scope')
    const seen = new Set<string>()
    for (const pair of rawQuery.split('&')) {
      const equals = pair.indexOf('=')
      const key = equals === -1 ? pair : pair.slice(0, equals)
      const entry = equals === -1 ? '' : pair.slice(equals + 1)
      if (!(queryKeys as readonly string[]).includes(key)) invalid(`Unsupported scope parameter ${key}`)
      if (seen.has(key)) invalid(`Duplicate scope parameter ${key}`)
      if (!scopePattern.test(entry)) invalid(`Invalid ${key} scope`)
      seen.add(key)
      if (key === 'task') scope.taskId = entry
      else if (key === 'session') scope.sessionId = entry
      else scope.version = entry
    }
  }
  return { scheme, id, scope }
}

/** A URI scoped to another task or session is refused before any provider is consulted. */
export function assertScopeAuthorized(reference: ResourceReference, authority: ResourceScope): void {
  if (reference.scope.taskId && reference.scope.taskId !== authority.taskId) throw new ResourceError('RESOURCE_UNAUTHORIZED', `${reference.id}: task scope does not match the authoritative task`)
  if (reference.scope.sessionId && reference.scope.sessionId !== authority.sessionId) throw new ResourceError('RESOURCE_UNAUTHORIZED', `${reference.id}: session scope does not match the authoritative session`)
}

export const resourceProviderDescriptorSchema = z.object({
  scheme: z.string().regex(schemePattern),
  version: z.number().int().min(1),
  owner: z.object({ pluginId: z.string().min(1), version: z.string().min(1) }).strict().optional(),
  capabilities: z.object({
    read: z.boolean().default(false),
    write: z.boolean().default(false),
    list: z.boolean().default(false),
    watch: z.boolean().default(false)
  }).strict()
}).strict()
export type ResourceProviderDescriptor = z.infer<typeof resourceProviderDescriptorSchema>
export type ResourceOperation = 'read' | 'write' | 'list' | 'watch'

export interface ResourceEntry {
  uri: string
  version: string
  contentType?: string
  size?: number
  immutable?: boolean
}

export interface ResourceReadResult {
  uri: string
  version: string
  contentType?: string
  /** Bounded stream: consumers pull chunks, providers must not buffer whole files. */
  stream: AsyncIterable<Uint8Array>
}

export interface ResourceWriteRequest {
  contentType?: string
  /** Expected current version; omit it with `createOnly` to create a new resource. */
  expectedVersion?: string
  createOnly?: boolean
  stream: AsyncIterable<Uint8Array>
}

/** Authority an operation runs with. Providers must re-check it and never trust the URI alone. */
export interface ResourceOperationContext {
  authority: ResourceScope
  deadline: number
  signal: AbortSignal
}

/**
 * A provider owns one scheme. Implementations may be local, in another process or remote; the
 * registry only dispatches operations the descriptor advertised.
 */
export interface ResourceProvider {
  read?(uri: string, context: ResourceOperationContext): Promise<ResourceReadResult>
  list?(uri: string, context: ResourceOperationContext): Promise<ResourceEntry[]>
  write?(uri: string, request: ResourceWriteRequest, context: ResourceOperationContext): Promise<ResourceEntry>
  watch?(uri: string, context: ResourceOperationContext): Promise<AsyncIterable<ResourceWatchEvent>>
}

export interface ResourceWatchEvent {
  kind: 'change' | 'resync-required'
  uri: string
  version?: string
  sequence?: number
}
