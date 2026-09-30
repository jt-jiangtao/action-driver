import type {
  Clock,
  EventRepository,
  IdGenerator,
  ModelGateway,
  ModelResult,
  RuntimeAdapters,
  RuntimeEventRecord,
  RuntimeTaskRecord,
  SessionCatalogRecord,
  SkillProvider,
  TaskRepository
} from '@action-driver/agent-runtime/ports'
import { LangGraphRunner } from '@action-driver/agent-runtime/agent-graph'
import { RuntimeSkillRegistry } from '@action-driver/agent-runtime/skill-registry'

/**
 * Goal markers that make the deterministic Runtime bindings repeatable for tests, visual acceptance
 * and offline development. They only affect the deterministic ModelGateway; this change never
 * reaches a real model provider.
 *
 * - `（长时间准备）` keeps the first plan call pending until the run is interrupted.
 * - `（等待确认）` asks the Skill to report that the Agent must wait for user input.
 */
export const MOCK_PENDING_PLAN_MARKER = '（长时间准备）'
export const MOCK_USER_INPUT_MARKER = '（等待确认）'

export class DeterministicModelGateway implements ModelGateway {
  private readonly planAttempts = new Map<string, number>()

  async complete(
    request: Parameters<ModelGateway['complete']>[0],
    signal?: AbortSignal
  ): Promise<ModelResult> {
    const lastUserMessage = [...request.messages]
      .reverse()
      .find((message) => message.role === 'user' && 'content' in message)
    const input = lastUserMessage && 'content' in lastUserMessage ? lastUserMessage.content : ''
    const goal =
      typeof input === 'string'
        ? input
        : input
            .filter((part) => part.kind === 'text')
            .map((part) => part.text)
            .join('')
    const skill = request.skills[0]

    if (!skill) return { kind: 'finish', content: goal }

    const attempt = (this.planAttempts.get(request.requestId) ?? 0) + 1
    this.planAttempts.set(request.requestId, attempt)

    if (attempt === 1 && goal.includes(MOCK_PENDING_PLAN_MARKER)) {
      return await this.blockUntilAborted(signal)
    }

    if (goal.includes(MOCK_USER_INPUT_MARKER)) {
      return {
        kind: 'invoke-skill',
        skillId: skill.skillId,
        input: { goal, needsUser: true }
      }
    }

    return {
      kind: 'invoke-skill',
      skillId: skill.skillId,
      input: { goal }
    }
  }

  private async blockUntilAborted(signal?: AbortSignal): Promise<ModelResult> {
    if (!signal) {
      throw new Error('MOCK_PENDING_PLAN_REQUIRES_ABORT_SIGNAL')
    }
    if (signal.aborted) throw abortError()
    return await new Promise<ModelResult>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(abortError()), { once: true })
    })
  }
}

function abortError(): Error {
  return new DOMException('The operation was aborted', 'AbortError')
}

export class MockSkillProvider implements SkillProvider {
  readonly providerVersion = '1.0.0'
  readonly contractVersion = 1

  constructor(
    readonly skillId: string,
    readonly providerId: string
  ) {}

  async execute(request: Parameters<SkillProvider['execute']>[0]) {
    return { ok: true as const, providerId: this.providerId, input: request.input }
  }
}

export class MockSkillRegistry extends RuntimeSkillRegistry {
  constructor(
    providers: SkillProvider[] = [
      new MockSkillProvider('browser-use', 'mock.browser'),
      new MockSkillProvider('computer-use', 'mock.computer')
    ]
  ) {
    super()
    for (const provider of providers) {
      this.register(provider)
    }
  }
}

class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<string, RuntimeTaskRecord>()
  private readonly metadata = new Map<string, { pinned: boolean; archivedAt: string | null }>()

  private record(task: RuntimeTaskRecord): SessionCatalogRecord {
    const metadata = this.metadata.get(task.sessionId)
    return {
      task,
      pinned: metadata?.pinned ?? false,
      archived: metadata?.archivedAt !== null && metadata?.archivedAt !== undefined,
      archivedAt: metadata?.archivedAt ?? null
    }
  }

  async listSessions(input: {
    archived: boolean
    query?: string
    limit: number
    cursor?: string | null
  }) {
    const query = (input.query ?? '').trim().toLocaleLowerCase()
    const records = (await Promise.all((await this.listRecentSessions(this.tasks.size)).map(async (task) => ({
      ...this.record(task), title: (await this.listBySession(task.sessionId))[0]?.goal ?? task.goal
    }))))
      .filter(
        (item) =>
          item.archived === input.archived && item.title.toLocaleLowerCase().includes(query)
      )
      .sort((left, right) => {
        const leftTime = input.archived ? (left.archivedAt ?? '') : left.task.updatedAt
        const rightTime = input.archived ? (right.archivedAt ?? '') : right.task.updatedAt
        return (
          rightTime.localeCompare(leftTime) ||
          right.task.sessionId.localeCompare(left.task.sessionId)
        )
      })
    const start = input.cursor
      ? Math.max(0, records.findIndex((item) => item.task.sessionId === input.cursor) + 1)
      : 0
    const items = records.slice(start, start + Math.max(1, Math.min(input.limit, 100)))
    return {
      items,
      nextCursor:
        start + items.length < records.length ? (items.at(-1)?.task.sessionId ?? null) : null
    }
  }

  async setSessionPinned(sessionId: string, pinned: boolean): Promise<SessionCatalogRecord> {
    const task = await this.getLatestBySession(sessionId)
    if (!task) throw new Error(`Unknown session: ${sessionId}`)
    const previous = this.metadata.get(sessionId)
    this.metadata.set(sessionId, { pinned, archivedAt: previous?.archivedAt ?? null })
    return this.record(task)
  }

  async setSessionArchived(sessionId: string, archived: boolean): Promise<SessionCatalogRecord> {
    const task = await this.getLatestBySession(sessionId)
    if (!task) throw new Error(`Unknown session: ${sessionId}`)
    const previous = this.metadata.get(sessionId)
    this.metadata.set(sessionId, {
      pinned: previous?.pinned ?? false,
      archivedAt: archived ? (previous?.archivedAt ?? new Date().toISOString()) : null
    })
    return this.record(task)
  }

  async deleteSession(sessionId: string): Promise<void> {
    const task = await this.getLatestBySession(sessionId)
    if (!task) throw new Error(`Unknown session: ${sessionId}`)
    if (!this.metadata.get(sessionId)?.archivedAt)
      throw new Error('Only archived sessions can be deleted')
    if (task.status === 'running' || task.status === 'queued')
      throw new Error('Cannot delete a running or queued session')
    for (const item of await this.listBySession(sessionId)) this.tasks.delete(item.id)
    this.metadata.delete(sessionId)
  }

  async get(taskId: string): Promise<RuntimeTaskRecord | null> {
    return this.tasks.get(taskId) ?? null
  }

  async getLatestBySession(sessionId: string): Promise<RuntimeTaskRecord | null> {
    return (await this.listBySession(sessionId)).at(-1) ?? null
  }

  async listBySession(sessionId: string): Promise<RuntimeTaskRecord[]> {
    return [...this.tasks.values()]
      .filter((task) => task.sessionId === sessionId)
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt)
      )
      .map((task) => structuredClone(task))
  }

  async listRecent(limit: number): Promise<RuntimeTaskRecord[]> {
    return [...this.tasks.values()]
      .sort((left, right) =>
        right.updatedAt === left.updatedAt
          ? right.id.localeCompare(left.id)
          : right.updatedAt.localeCompare(left.updatedAt)
      )
      .slice(0, limit)
      .map((task) => structuredClone(task))
  }

  async listRecentSessions(limit: number): Promise<RuntimeTaskRecord[]> {
    const latest = new Map<string, RuntimeTaskRecord>()
    for (const task of await this.listRecent(this.tasks.size)) {
      if (!latest.has(task.sessionId)) latest.set(task.sessionId, task)
    }
    return [...latest.values()].slice(0, limit)
  }

  async save(task: RuntimeTaskRecord): Promise<void> {
    this.tasks.set(task.id, structuredClone(task))
  }
}

class InMemoryEventRepository implements EventRepository {
  private readonly events: RuntimeEventRecord[] = []

  async append(event: Omit<RuntimeEventRecord, 'cursor'>): Promise<RuntimeEventRecord> {
    const stored = { ...structuredClone(event), cursor: this.events.length + 1 }
    this.events.push(stored)
    return stored
  }

  async listAfter(cursor: number): Promise<RuntimeEventRecord[]> {
    return structuredClone(this.events.filter((event) => event.cursor > cursor))
  }

  async listForRequestAfter(
    requestId: string,
    cursor: number,
    limit: number
  ): Promise<RuntimeEventRecord[]> {
    return structuredClone(
      this.events
        .filter((event) => event.requestId === requestId && event.cursor > cursor)
        .slice(0, limit)
    )
  }
}

class DeterministicClock implements Clock {
  now(): string {
    return '2026-01-01T00:00:00.000Z'
  }
}

class SequentialIdGenerator implements IdGenerator {
  private current = 0

  next(prefix: string): string {
    this.current += 1
    return `${prefix}-${this.current}`
  }
}

export function createMockRuntimeAdapters(): RuntimeAdapters {
  const modelGateway = new DeterministicModelGateway()
  const skillRegistry = new MockSkillRegistry()

  return {
    graphRunner: new LangGraphRunner(modelGateway, skillRegistry),
    taskRepository: new InMemoryTaskRepository(),
    eventRepository: new InMemoryEventRepository(),
    modelGateway,
    skillRegistry,
    clock: new DeterministicClock(),
    idGenerator: new SequentialIdGenerator()
  }
}
