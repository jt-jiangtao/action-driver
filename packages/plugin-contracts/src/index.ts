import { pluginToolDefinitionSchema as toolDefinitionSchema, type ToolDefinition } from './tool.js'
export * from './tool.js'
import { z } from 'zod'
import { satisfies, valid, validRange } from 'semver'

export const PLUGIN_PROTOCOL_VERSION = 1
export const PLUGIN_SDK_VERSION = '1.0.0'
const identity = z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
const contributionId = z.string().regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/)
const version = z.string().refine(value => valid(value) !== null, 'Invalid semantic version')
const range = z.string().refine(value => validRange(value) !== null, 'Invalid version range')
const entry = z.string().min(1).refine(value => !value.startsWith('/') && !value.includes('\\') && !value.split('/').some(part => part === '..' || part === '.' || part === ''), 'Entry must be package-relative')
export const contributionSchema = z.object({
  kind: z.enum(['tool', 'command', 'skill', 'capability', 'service', 'panel']),
  id: contributionId,
  modelName: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional()
}).strict()
export const manifestSchema = z.object({
  id: identity, version, sdk: range, entry, catalog: entry.optional(),
  platforms: z.array(z.string().regex(/^(darwin|linux|win32)-(arm64|x64)$/)).min(1),
  requires: z.array(z.string().min(1)).optional(),
  services: z.array(z.lazy(() => serviceDefinitionSchema)).optional(),
  panels: z.array(z.lazy(() => panelDefinitionSchema)).optional(),
  activation: z.array(z.string().min(1)).default([]),
  contributions: z.array(contributionSchema).default([]),
  dependencies: z.array(z.object({ id: identity, version: range, optional: z.boolean().default(false) }).strict()).default([])
}).strict()
export type PluginManifest = z.infer<typeof manifestSchema>
export type Contribution = z.infer<typeof contributionSchema>
export interface PluginOwner { pluginId: string; version: string; hostEpoch: string }
export type PluginErrorCode = 'INVALID_MANIFEST' | 'INCOMPATIBLE' | 'PLATFORM_UNAVAILABLE' | 'CONTRIBUTION_CONFLICT' | 'DEPENDENCY_MISSING' | 'DEPENDENCY_INCOMPATIBLE' | 'DEPENDENCY_CYCLE' | 'STALE_INSTANCE' | 'UNAVAILABLE' | 'PROTOCOL_ERROR' | 'RESULT_UNKNOWN' | 'CANCELLED' | 'MIGRATION_UNSAFE' | 'AUTHORIZATION_DENIED' | 'DEADLINE_EXCEEDED'
export interface PluginErrorDTO { code: string; message: string; owner?: PluginOwner }
export class PluginError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = 'PluginError' }
  static fromDTO(value: unknown): PluginError {
    const dto = z.object({ code: z.string().min(1), message: z.string() }).passthrough().safeParse(value)
    if (!dto.success) return new PluginError('PROTOCOL_ERROR', 'Malformed remote error')
    const error = new PluginError(dto.data.code, dto.data.message)
    error.message = dto.data.message
    return error
  }
}
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export interface InvocationContext {
  requestId: string; callId: string; taskId?: string; sessionId?: string
  deadline: number; workspaceHandle?: string; source: PluginOwner | { kind: 'runtime' }
  chain: string[]; grants?: string[]
}
export interface PluginHandshake extends PluginOwner {
  protocol: number; sdk: string; token: string
}
export interface PluginRPCEnvelope extends PluginOwner {
  protocol: number; token: string; requestId: string; method: string; payload: Json
}
export function validateManifest(value: unknown, host: { sdk: string; platform: string }): PluginManifest {
  const result = manifestSchema.safeParse(value)
  if (!result.success) throw new PluginError('INVALID_MANIFEST', result.error.message)
  const manifest = result.data
  if (!satisfies(host.sdk, manifest.sdk)) throw new PluginError('INCOMPATIBLE', `${manifest.id} requires SDK ${manifest.sdk}; host ${host.sdk}`)
  if (!manifest.platforms.includes(host.platform)) throw new PluginError('PLATFORM_UNAVAILABLE', `${manifest.id}: ${host.platform}`)
  const ids = new Set<string>(), names = new Set<string>()
  for (const item of manifest.contributions) {
    const key = `${item.kind}:${item.id}`
    if (ids.has(key) || (item.modelName && names.has(item.modelName))) throw new PluginError('CONTRIBUTION_CONFLICT', `${manifest.id}: ${key}`)
    ids.add(key)
    if (item.modelName) names.add(item.modelName)
  }
  return manifest
}
export function resolveDependencies(manifests: PluginManifest[]): PluginManifest[] {
  const byId = new Map<string, PluginManifest>()
  for (const manifest of manifests) {
    if (byId.has(manifest.id)) throw new PluginError('CONTRIBUTION_CONFLICT', `Duplicate plugin ${manifest.id}`)
    byId.set(manifest.id, manifest)
  }
  const done = new Set<string>(), visiting = new Set<string>(), ordered: PluginManifest[] = []
  const visit = (manifest: PluginManifest): void => {
    if (done.has(manifest.id)) return
    if (visiting.has(manifest.id)) throw new PluginError('DEPENDENCY_CYCLE', [...visiting, manifest.id].join(' -> '))
    visiting.add(manifest.id)
    for (const dependency of manifest.dependencies) {
      const target = byId.get(dependency.id)
      if (!target) {
        if (dependency.optional) continue
        throw new PluginError('DEPENDENCY_MISSING', `${manifest.id} requires ${dependency.id}`)
      }
      if (!satisfies(target.version, dependency.version)) throw new PluginError('DEPENDENCY_INCOMPATIBLE', `${manifest.id} requires ${dependency.id}@${dependency.version}; found ${target.version}`)
      visit(target)
    }
    visiting.delete(manifest.id); done.add(manifest.id); ordered.push(manifest)
  }
  manifests.forEach(visit)
  return ordered
}

export const skillContributionSchema = z.object({ id: identity, name: z.string().min(1), description: z.string().min(1), content: z.string().min(1), resources: z.array(entry).default([]) }).strict()
export type SkillContribution = z.infer<typeof skillContributionSchema>
export interface PluginCatalog { tools: ToolDefinition[]; skills: SkillContribution[] }
export function validateCatalog(value: unknown, manifest: PluginManifest): PluginCatalog {
  const catalog = z.object({ tools: z.array(toolDefinitionSchema), skills: z.array(skillContributionSchema) }).strict().parse(value)
  const seen = new Set<string>(), names = new Set<string>()
  for (const [kind, items] of [['tool', catalog.tools], ['skill', catalog.skills]] as const) {
    for (const item of items) {
      if (!manifest.contributions.some(declared => declared.kind === kind && declared.id === item.id && (kind !== 'tool' || declared.modelName === ('modelName' in item ? item.modelName : undefined)))) throw new PluginError('INVALID_MANIFEST', `Undeclared ${kind} ${item.id}`)
      if (seen.has(`${kind}:${item.id}`)) throw new PluginError('CONTRIBUTION_CONFLICT', item.id)
      seen.add(`${kind}:${item.id}`)
      if ('modelName' in item) {
        if (names.has(item.modelName)) throw new PluginError('CONTRIBUTION_CONFLICT', item.modelName)
        names.add(item.modelName)
      }
    }
  }
  return catalog
}
export const serviceDefinitionSchema = z.object({
  id: identity, kind: z.enum(['node', 'native', 'mcp-stdio', 'mcp-http']),
  runtime: z.enum(['node', 'native']).optional(), entry: entry.optional(),
  artifacts: z.record(z.string(), entry).optional(), url: z.url().optional(),
  args: z.array(z.string()).optional(),
  restart: z.object({ attempts: z.number().int().min(0).max(3), backoffMs: z.number().int().min(10).max(10000) }).strict().optional()
}).strict()
export type ServiceDefinition = z.infer<typeof serviceDefinitionSchema>

export const panelDefinitionSchema = z.object({
  id: identity,
  title: z.string().min(1).max(200).optional(),
  entry: entry.optional(),
  url: z.string().url().refine(value => new URL(value).protocol === 'https:', 'Remote panels require HTTPS').optional(),
  messages: z.record(z.string().regex(/^[a-z][a-z0-9.-]*$/), z.record(z.string(), z.json())).default({})
}).strict().refine(value => Boolean(value.entry) !== Boolean(value.url), 'Declare one package entry or HTTPS URL')
export type PanelDefinition = z.infer<typeof panelDefinitionSchema>

export * from './tool-identity.js'
