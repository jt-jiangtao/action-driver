import { turnMetadata } from './service-discovery.js'
import type { GuardianOrigin, GuardianReview } from './service-guardian-cache.js'
import type { ConfigStore, ConfigSnapshot } from './service-config.js'
export interface PermissionHost {
  requestMeta?: Record<string, unknown> | undefined
}
export interface PermissionTurn {
  sessionId: string
  turnId: string
}
export interface OriginRequestContext {
  preferenceSessionId: string | undefined
  guardianMode: 'v1' | 'v2'
  guardianOrigin: GuardianOrigin | undefined
  turn: PermissionTurn | undefined
}
export type PermissionResource =
  | { kind: 'origin'; origin: string }
  | { kind: 'fileTransfer'; origin: string; transferKind: 'download' | 'upload' }
  | { kind: 'fullCdp'; origin: string }
export interface PermissionRequest extends Partial<OriginRequestContext> {
  resource: PermissionResource
  requireSavedPermissions?: boolean
  guardianReview?: GuardianReview | undefined
  guardianReviewRequested?: boolean
}
export interface PromptResult {
  action: string
  _meta?: Record<string, unknown> | undefined
  content?: unknown
}
export const unavailableSnapshot = Error('Browser-use config cannot refresh a complete snapshot')
const valid = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0
const first = (data: Record<string, unknown> | undefined, keys: string[]) =>
  keys.map((key) => data?.[key]).find(valid)
export const validSession = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 128 &&
  /^[A-Za-z0-9_-]+$/u.test(value)
const session = (data: Record<string, unknown> | undefined) =>
  data?.thread_source === 'subagent' && typeof data.thread_id === 'string'
    ? data.thread_id
    : typeof data?.session_id === 'string'
      ? data.session_id
      : undefined
export function contextForOrigin(host: PermissionHost, origin: string): OriginRequestContext {
  const meta = turnMetadata(host),
    request = host.requestMeta,
    id = session(meta),
    preferenceSessionId =
      id ??
      first(request, [
        'conversation_id',
        'conversationId',
        'thread_id',
        'threadId',
        'session_id',
        'sessionId'
      ]),
    guardianMode =
      (meta?.node_repl_auto_review_required ??
        request?.node_repl_auto_review_required ??
        request?.nodeReplAutoReviewRequired) === true
        ? 'v2'
        : 'v1'
  let thread = first(meta, ['thread_id']) ?? first(request, ['thread_id', 'threadId'])
  if (thread === undefined) {
    const source =
        first(meta, ['thread_source']) ?? first(request, ['thread_source', 'threadSource']),
      parent =
        first(meta, ['parent_thread_id']) ?? first(request, ['parent_thread_id', 'parentThreadId'])
    if (parent == null && (source == null || source === 'user'))
      thread =
        first(meta, ['session_id']) ??
        first(request, ['conversation_id', 'conversationId', 'session_id', 'sessionId'])
  }
  let normalized: string | null = null
  try {
    const url = new URL(origin)
    if (url.protocol === 'file:') {
      url.search = ''
      url.hash = ''
      normalized = url.href
    } else if (['http:', 'https:'].includes(url.protocol)) normalized = url.origin
  } catch {}
  const fallbackSession = first(request, ['conversation_id', 'thread_id', 'session_id']),
    fallbackTurn = first(request, ['turn_id', 'turnId']),
    turn =
      id !== undefined && typeof meta?.turn_id === 'string'
        ? { sessionId: id, turnId: meta.turn_id }
        : fallbackSession && fallbackTurn
          ? { sessionId: fallbackSession, turnId: fallbackTurn }
          : undefined
  return {
    preferenceSessionId,
    guardianMode,
    guardianOrigin:
      thread != null && normalized != null ? { threadId: thread, origin: normalized } : undefined,
    turn
  }
}
export const tableFor = (resource: PermissionResource) =>
  resource.kind === 'origin'
    ? 'origins'
    : resource.kind === 'fullCdp'
      ? 'full_cdp'
      : resource.kind === 'fileTransfer'
        ? resource.transferKind === 'download'
          ? 'downloads'
          : 'uploads'
        : undefined
export const modeFor = (resource: PermissionResource) =>
  resource.kind === 'origin'
    ? 'approval_mode'
    : resource.kind === 'fullCdp'
      ? null
      : resource.kind === 'fileTransfer'
        ? resource.transferKind === 'download'
          ? 'download_approval_mode'
          : 'upload_approval_mode'
        : undefined
export const defaultConversation = (resource: PermissionResource) =>
  resource.kind === 'origin' || resource.kind === 'fullCdp'
export async function snapshotFor(
  store: ConfigStore,
  keys: string[],
  refresh: boolean
): Promise<ConfigSnapshot> {
  if (refresh) {
    if (store.readSnapshot == null) throw unavailableSnapshot
    return store.readSnapshot({ refresh: true })
  }
  const values = await Promise.all(keys.map(async (key) => [key, await store.get(key)] as const))
  return Object.fromEntries(values.filter(([, value]) => value !== undefined))
}
function glob(pattern: string, value: string) {
  let expression = '^'
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!
    if (char === '*') {
      expression += '.*'
      continue
    }
    if (char === '\\' && ['*', '\\'].includes(pattern[index + 1] ?? '')) {
      expression += pattern[++index]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      continue
    }
    expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(expression + '$', 'su').test(value)
}
function hostPort(origin: string) {
  const index = origin.indexOf('://')
  if (index === -1 || !['http', 'https'].includes(origin.slice(0, index).toLowerCase())) return null
  const authority = origin.slice(index + 3).split(/[/?#]/u, 1)[0] ?? ''
  return authority.split('@').at(-1)?.trim() || null
}
export function tableMatches(
  snapshot: ConfigSnapshot,
  key: string | undefined,
  decision: 'allowed' | 'denied',
  origin: string
) {
  if (key === undefined) return false
  const table = snapshot[key]
  if (table === null || typeof table !== 'object' || Array.isArray(table)) return false
  const entries = (table as ConfigSnapshot)[decision]
  if (!Array.isArray(entries)) return false
  const authority = hostPort(origin)
  return entries.some((value) => {
    if (typeof value !== 'string') return false
    const pattern = value.trim()
    return (
      glob(pattern, pattern.includes('://') ? origin : (authority ?? origin)) &&
      (pattern.includes('://') || authority !== null || !origin.includes('://'))
    )
  })
}
export function persistenceScope(result: PromptResult): 'conversation' | 'global' | null {
  for (const data of [result._meta, result.content])
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      const value = (data as ConfigSnapshot).persist
      if (value === 'session') return 'conversation'
      if (value === 'always') return 'global'
    }
  return null
}
export function allSites(result: PromptResult) {
  return [result._meta, result.content].some(
    (data) =>
      data !== null &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      (data as ConfigSnapshot).browser_use_persistent_approval_scope === 'all-sites'
  )
}
export const autoReviewed = (result: PromptResult) =>
  result._meta?.approvals_reviewer === 'guardian_subagent' ||
  result._meta?.approvals_reviewer === 'auto_review'
export const userReviewed = (result: PromptResult) =>
  result._meta?.approvals_reviewer == null || result._meta.approvals_reviewer === 'user'
export async function persistResource(
  store: ConfigStore,
  resource: PermissionResource,
  decision: 'approve' | 'deny'
) {
  const key = tableFor(resource),
    origin = resource.origin.replace(/\\/g, '\\\\').replace(/\*/g, '\\*')
  if (key === undefined) return
  await store.update((snapshot) => {
    const result = { ...snapshot },
      previous = result[key]
    if (previous != null && (typeof previous !== 'object' || Array.isArray(previous)))
      throw Error(`browser-use table ${key} must be an object`)
    const table = previous == null ? {} : { ...(previous as ConfigSnapshot) },
      selected = decision === 'approve' ? 'allowed' : 'denied',
      opposite = selected === 'allowed' ? 'denied' : 'allowed'
    if (Array.isArray(table[opposite]))
      table[opposite] = (table[opposite] as unknown[]).filter(
        (value) => value !== resource.origin && value !== origin
      )
    if (table[selected] == null) table[selected] = [origin]
    else {
      if (!Array.isArray(table[selected]))
        throw Error(`browser-use table key ${selected} must be an array`)
      const entries = (table[selected] as unknown[]).filter(
        (value): value is string => typeof value === 'string'
      )
      if (!entries.includes(origin)) entries.push(origin)
      table[selected] = entries
    }
    result[key] = table
    return result
  })
}
export const reviewTurnCache = new Map<
  string,
  { turnId: string; origin: string; expiresAt: number }
>()
export const userTurnCache = new Map<string, { turnId: string; origins: Set<string> }>()
export function turnApproved(request: PermissionRequest, review: boolean) {
  const turn = request.turn
  if (request.resource.kind !== 'origin' || !turn) return false
  if (review) {
    if (request.guardianMode !== 'v1') return false
    const cached = reviewTurnCache.get(turn.sessionId)
    if (
      cached &&
      (cached.expiresAt <= Date.now() ||
        cached.turnId !== turn.turnId ||
        cached.origin !== request.resource.origin)
    ) {
      reviewTurnCache.delete(turn.sessionId)
      return false
    }
    return cached != null
  } else {
    if (turn.sessionId !== request.preferenceSessionId || turn.turnId.trim() === '') return false
    const cached = userTurnCache.get(turn.sessionId)
    if (cached && cached.turnId !== turn.turnId) {
      userTurnCache.delete(turn.sessionId)
      return false
    }
    return cached?.origins.has(request.resource.origin) ?? false
  }
}
export function recordTurnApproval(request: PermissionRequest, review: boolean) {
  const turn = request.turn
  if (!turn || request.resource.kind !== 'origin') return
  if (review) {
    reviewTurnCache.set(turn.sessionId, {
      turnId: turn.turnId,
      origin: request.resource.origin,
      expiresAt: Date.now() + 300000
    })
    return
  }
  if (!validSession(turn.sessionId) || turn.turnId.trim() === '') return
  let cached = userTurnCache.get(turn.sessionId)
  if (cached?.turnId !== turn.turnId) {
    cached = { turnId: turn.turnId, origins: new Set() }
    userTurnCache.set(turn.sessionId, cached)
  }
  cached!.origins.add(request.resource.origin)
}
