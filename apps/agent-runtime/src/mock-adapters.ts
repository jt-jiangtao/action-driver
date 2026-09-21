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

export class DeterministicModelGateway implements ModelGateway {
  async complete(request: Parameters<ModelGateway['complete']>[0]): Promise<ModelResult> {
    const goal =
      [...request.messages].reverse().find((message) => message.role === 'user')?.content ?? ''
    const skill = request.skills[0]

    if (!skill) return { kind: 'finish', content: goal }

    return {
      kind: 'invoke-skill',
      skillId: skill.skillId,
      input: { goal }
    }
  }
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
