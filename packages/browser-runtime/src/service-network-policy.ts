import { isIP } from 'node:net'
type Data = Record<string, unknown>
const object = (value: unknown): Data | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : null
const field = (value: unknown, key: string) => object(value)?.[key]
function asciiLower(value: string) {
  return value.replace(/[A-Z]/g, (char) => char.toLowerCase())
}
function normalizedHost(value: string) {
  value = value.trim()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end !== -1) value = value.slice(1, end)
  } else if ((value.match(/:/g) ?? []).length === 1) value = value.split(':')[0] ?? ''
  value = asciiLower(value).replace(/\.+$/u, '')
  for (const marker of ['%25', '%']) {
    const at = value.indexOf(marker)
    if (at !== -1 && isIP(value.slice(0, at)) !== 0)
      return value.slice(0, at) + '%' + value.slice(at + marker.length)
  }
  return value
}
interface HostPattern {
  canonicalPattern: string
  hostnamePattern: string
  kind: 'exact' | 'subdomains-only' | 'apex-and-subdomains'
}
export interface OriginPattern {
  canonicalKey: string
  canonicalPattern: string
  hostnamePattern: HostPattern
  port: string
  protocol: string
}
function hostPattern(value: string): HostPattern | null {
  const kind = value.startsWith('**.')
      ? 'apex-and-subdomains'
      : value.startsWith('*.')
        ? 'subdomains-only'
        : 'exact',
    prefix = kind === 'apex-and-subdomains' ? '**.' : kind === 'subdomains-only' ? '*.' : '',
    hostnamePattern = normalizedHost(value.slice(prefix.length)),
    canonicalPattern = prefix + hostnamePattern
  if (/[[\]{}\\]/u.test(canonicalPattern)) return null
  return { canonicalPattern, hostnamePattern, kind }
}
export function parseOriginPattern(input: string): OriginPattern | null {
  if (input !== input.trim() || /\s/u.test(input)) return null
  const split = input.indexOf('://')
  if (split <= 0) return null
  const authority = input.slice(split + 3)
  if (!authority || /[/?#\\@]/u.test(authority)) return null
  let host: string
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    if (end <= 1) return null
    const rest = authority.slice(end + 1)
    if (rest !== '' && !/^:\d+$/u.test(rest)) return null
    host = authority.slice(0, end + 1)
  } else {
    const colon = authority.indexOf(':')
    if (
      colon !== -1 &&
      (colon !== authority.lastIndexOf(':') || !/^\d+$/u.test(authority.slice(colon + 1)))
    )
      return null
    host = colon === -1 ? authority : authority.slice(0, colon)
    if (
      !host ||
      host.includes('%') ||
      host.endsWith('..') ||
      host
        .replace(/\.$/u, '')
        .split('.')
        .some((part) => part.length === 0 || (part.includes('*') && /[^\p{ASCII}]/u.test(part)))
    )
      return null
  }
  try {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    const normalized = url.hostname.replace(/%2a/giu, '*'),
      pattern = hostPattern(normalized)
    if (!pattern) return null
    const formatted = normalized.startsWith('[')
      ? `[${pattern.canonicalPattern}]`
      : pattern.canonicalPattern
    return {
      canonicalKey: JSON.stringify([url.protocol, pattern.canonicalPattern, url.port]),
      canonicalPattern: `${url.protocol}//${formatted}${url.port ? ':' + url.port : ''}`,
      hostnamePattern: pattern,
      port: url.port,
      protocol: url.protocol
    }
  } catch {
    return null
  }
}
function wildcard(pattern: string, value: string) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'u').test(value)
}
function matchesOrigin(pattern: OriginPattern, url: URL) {
  if (pattern.protocol !== url.protocol || pattern.port !== url.port) return false
  const host = normalizedHost(url.hostname),
    shape = pattern.hostnamePattern
  if (shape.kind !== 'subdomains-only' && wildcard(shape.hostnamePattern, host)) return true
  if (shape.kind === 'exact') return false
  for (let dot = host.indexOf('.'); dot > 0; dot = host.indexOf('.', dot + 1))
    if (wildcard(shape.hostnamePattern, host.slice(dot + 1))) return true
  return false
}
const denyValues = {
  access: 'deny',
  uploads: 'deny',
  downloads: 'deny',
  fullCdpAccess: 'deny',
  autoReview: 'deny',
  persistentApproval: false,
  accessApprovalLifetime: 'turn'
} as const
export interface OriginPolicy {
  access: string
  uploads: string
  downloads: string
  fullCdpAccess: string
  autoReview: string
  persistentApproval: boolean
  accessApprovalLifetime: string
}
function matchedPolicy(policy: unknown, url: URL) {
  const raw = object(policy) ?? {},
    origins = object(raw.origins) ?? {},
    patterns = Object.entries(origins).map(([key, value]) => ({
      pattern: parseOriginPattern(key),
      policy: object(value)
    })),
    counts = new Map<string, number>()
  for (const { pattern } of patterns)
    if (pattern) counts.set(pattern.canonicalKey, (counts.get(pattern.canonicalKey) ?? 0) + 1)
  const matching = patterns.filter(
    ({ pattern, policy }) => pattern !== null && policy !== null && matchesOrigin(pattern, url)
  )
  const resolved: Data = {}
  for (const [key, deny] of Object.entries(denyValues)) {
    let value: unknown = null
    for (const entry of matching) {
      const selected = entry.policy![key]
      if (selected === deny) {
        value = deny
        break
      }
      if (counts.get(entry.pattern!.canonicalKey) === 1 && selected != null) value = selected
    }
    resolved[key] = value ?? field(raw.defaultOriginPolicy, key) ?? null
  }
  return resolved
}
function userOriginPolicy(config: unknown) {
  const raw = object(config) ?? {},
    convert = (policy: unknown) => {
      const value = object(policy)
      return value
        ? {
            access: value.access,
            uploads: value.uploads,
            downloads: value.downloads,
            fullCdpAccess: value.full_cdp_access
          }
        : undefined
    }
  return {
    origins: Object.fromEntries(
      Object.entries(object(raw.origins) ?? {}).map(([name, value]) => [name, convert(value)])
    ),
    defaultOriginPolicy: convert(raw.default_origin_policy)
  }
}
export function resolveOriginPolicy(
  requirements: unknown,
  config: unknown,
  input: string
): OriginPolicy {
  let url: URL | null = null
  try {
    const parsed = new URL(input)
    if (['http:', 'https:'].includes(parsed.protocol)) url = parsed
  } catch {}
  const enterprise = url ? matchedPolicy(requirements, url) : null,
    user = url ? matchedPolicy(userOriginPolicy(config), url) : null,
    resolved: Data = {}
  for (const [key, deny] of Object.entries(denyValues)) {
    const a = enterprise?.[key],
      b = user?.[key],
      fallback =
        key === 'persistentApproval' ? true : key === 'accessApprovalLifetime' ? 'thread' : 'allow'
    resolved[key] = a === deny || b === deny ? deny : (a ?? b ?? fallback)
  }
  if (resolved.access === 'deny')
    for (const key of ['uploads', 'downloads', 'fullCdpAccess', 'autoReview'])
      resolved[key] = 'deny'
  return resolved as unknown as OriginPolicy
}
export interface NetworkPolicy {
  enabled: boolean | null
  allowedDomains: string[]
  deniedDomains: string[]
  hardDenyAllowlistMisses: boolean
}
function domainLists(network: Data, typed: boolean): [string[], string[]] {
  const domains = typed
    ? network.domains == null
      ? null
      : (Object(network.domains) as Data)
    : object(network.domains)
  if (domains) {
    const allowed: string[] = [],
      denied: string[] = []
    for (const [host, decision] of Object.entries(domains))
      if (decision === 'allow') allowed.push(host)
      else if (decision === 'deny') denied.push(host)
    return [allowed, denied]
  }
  function strings(...names: string[]) {
    for (const name of names)
      if (Array.isArray(network[name]))
        return (network[name] as unknown[])
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
    return []
  }
  const managed = (name: string) =>
    ((network[name] ?? []) as string[]).map((value) => value.trim()).filter(Boolean)
  return typed
    ? [managed('allowedDomains'), managed('deniedDomains')]
    : [strings('allowedDomains', 'allowed_domains'), strings('deniedDomains', 'denied_domains')]
}
function append(target: string[], values: string[]) {
  for (const value of values)
    if (!target.some((existing) => existing.toLowerCase() === value.toLowerCase()))
      target.push(value)
}
export function resolveNetworkPolicy(requirements: unknown, config: unknown): NetworkPolicy {
  const state: NetworkPolicy = {
      enabled: null,
      allowedDomains: [],
      deniedDomains: [],
      hardDenyAllowlistMisses: false
    },
    enterprise = object(field(field(requirements, 'requirements'), 'network'))
  if (enterprise) {
    if (enterprise.enabled != null && (!enterprise.enabled || state.enabled == null))
      state.enabled = enterprise.enabled as boolean
    const [allowed, denied] = domainLists(enterprise, true)
    append(state.allowedDomains, allowed)
    append(state.deniedDomains, denied)
    state.hardDenyAllowlistMisses = (enterprise.managedAllowedDomainsOnly ?? false) as boolean
  }
  const raw = object(field(config, 'config')),
    name = raw?.default_permissions
  let user: Data | null = null
  if (typeof name === 'string' && name.trim())
    user = object(field(field(raw?.permissions, name.trim()), 'network'))
  if (user) {
    if (typeof user.enabled === 'boolean' && (!user.enabled || state.enabled == null))
      state.enabled = user.enabled
    const [allowed, denied] = domainLists(user, false)
    if (!state.hardDenyAllowlistMisses) append(state.allowedDomains, allowed)
    append(state.deniedDomains, denied)
  }
  return state
}
function matchesDomain(pattern: string, host: string) {
  let normalized = pattern.trim()
  const prefix = normalized.startsWith('**.') ? '**.' : normalized.startsWith('*.') ? '*.' : ''
  normalized = prefix + normalizedHost(normalized.slice(prefix.length))
  const target = normalizedHost(host)
  if (!normalized || !target) return false
  return normalized.startsWith('**.')
    ? wildcard(normalized.slice(3), target) || wildcard('*.' + normalized.slice(3), target)
    : wildcard(normalized, target)
}
export function networkDecision(input: string, policy: NetworkPolicy): 'deny' | null {
  let host: string
  try {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    host = normalizedHost(url.host)
  } catch {
    return null
  }
  if (
    policy.enabled === false ||
    policy.deniedDomains.some((pattern) => matchesDomain(pattern, host))
  )
    return 'deny'
  return policy.hardDenyAllowlistMisses &&
    !policy.allowedDomains.some((pattern) => matchesDomain(pattern, host))
    ? 'deny'
    : null
}
function userBrowserConfig(all: unknown) {
  return all == null ? undefined : (all as { config: { browser_use?: unknown } }).config.browser_use
}
interface PolicyConfig {
  readRequirements(): Promise<unknown>
  readAll(): Promise<unknown>
}
export async function readOriginPolicy(origin: string, config: PolicyConfig) {
  const [requirements, all] = await Promise.all([config.readRequirements(), config.readAll()])
  return resolveOriginPolicy(
    field(field(requirements, 'requirements'), 'browserUse'),
    userBrowserConfig(all),
    origin
  )
}
export async function accessPolicyDecision(
  origin: string,
  config: PolicyConfig
): Promise<'deny' | 'unavailable' | null> {
  try {
    const [requirements, all] = await Promise.all([config.readRequirements(), config.readAll()])
    const network = networkDecision(origin, resolveNetworkPolicy(requirements, all))
    return (
      network ??
      (resolveOriginPolicy(
        field(field(requirements, 'requirements'), 'browserUse'),
        userBrowserConfig(all),
        origin
      ).access === 'deny'
        ? 'deny'
        : null)
    )
  } catch {
    return 'unavailable'
  }
}
