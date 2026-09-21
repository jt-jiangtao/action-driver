import type { SkillExecuteRequest, SkillExecuteResult } from '@actiondriver/runtime-contracts'
import { LangGraphRunner } from './agent-graph'
import { openRuntimeDatabase } from './database'
import { DeterministicModelGateway } from './mock-adapters'
import type {
  Clock,
  IdGenerator,
  RuntimeAdapters,
  SkillProvider,
  SkillProviderResult
} from './ports'
import { SqliteRuntimeRepositories } from './repositories'
import { RuntimeSkillRegistry } from './skill-registry'
import { createSqliteCheckpointer, SqliteCheckpointStore } from './sqlite-checkpointer'

export type RequestHostedSkill = (request: SkillExecuteRequest) => Promise<SkillExecuteResult>

export type LocalRuntimeAdapters = {
  adapters: RuntimeAdapters
  close(): void
}

class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString()
  }
}

class RandomIdGenerator implements IdGenerator {
  next(prefix: string): string {
    return `${prefix}-${globalThis.crypto.randomUUID()}`
  }
}

class HostedSkillProvider implements SkillProvider {
  readonly providerVersion = '1.0.0'
  readonly contractVersion = 1

  constructor(
    readonly skillId: string,
    readonly providerId: string,
    private readonly requestSkill: RequestHostedSkill
  ) {}

  async execute(request: { invocationId: string; input: unknown }): Promise<SkillProviderResult> {
    const result = await this.requestSkill({
      invocationId: request.invocationId,
      requestedSkillId: this.skillId,
      resolvedProviderId: this.providerId,
      providerVersion: this.providerVersion,
      input: request.input
    })
    return { ok: true, providerId: this.providerId, input: result.output }
  }
}

export function createLocalRuntimeAdapters(
  databasePath: string,
  requestSkill: RequestHostedSkill
): LocalRuntimeAdapters {
  const repositories = new SqliteRuntimeRepositories(openRuntimeDatabase(databasePath))
  const checkpointer = createSqliteCheckpointer(databasePath)
  const checkpointStore = new SqliteCheckpointStore(checkpointer)
  const modelGateway = new DeterministicModelGateway()
  const skillRegistry = new RuntimeSkillRegistry()
  skillRegistry.register(new HostedSkillProvider('browser-use', 'mock.browser', requestSkill))
  skillRegistry.register(new HostedSkillProvider('computer-use', 'mock.computer', requestSkill))

  return {
    adapters: {
      graphRunner: new LangGraphRunner(modelGateway, skillRegistry, checkpointer),
      checkpointStore,
      taskRepository: repositories.tasks,
      eventRepository: repositories.events,
      modelGateway,
      skillRegistry,
      clock: new SystemClock(),
      idGenerator: new RandomIdGenerator()
    },
    close() {
      checkpointer.close()
      repositories.close()
    }
  }
}
