import type {
  CheckpointStore,
  Clock,
  EventRepository,
  IdGenerator,
  ModelGateway,
  ModelResult,
  RuntimeAdapters,
  RuntimeEventRecord,
  RuntimeTaskRecord,
  SkillProvider,
  TaskRepository
} from './ports'
import { LangGraphRunner } from './agent-graph'
import { RuntimeSkillRegistry } from './skill-registry'

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
    const goal = lastUserMessage && 'content' in lastUserMessage ? lastUserMessage.content : ''
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

class InMemoryCheckpointStore implements CheckpointStore {
  private readonly checkpoints = new Map<string, unknown>()

  async get(threadId: string): Promise<unknown | null> {
    return this.checkpoints.get(threadId) ?? null
  }

  async put(threadId: string, checkpoint: unknown): Promise<void> {
    this.checkpoints.set(threadId, checkpoint)
  }
}

class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<string, RuntimeTaskRecord>()

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
    checkpointStore: new InMemoryCheckpointStore(),
    taskRepository: new InMemoryTaskRepository(),
    eventRepository: new InMemoryEventRepository(),
    modelGateway,
    skillRegistry,
    clock: new DeterministicClock(),
    idGenerator: new SequentialIdGenerator()
  }
}
