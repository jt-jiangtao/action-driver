import { LangGraphRunner } from './agent-graph'
import type { Clock, IdGenerator, ModelGateway, RuntimeAdapters } from './ports'
import type { SqliteRuntimeRepositories } from './repositories'
import { RuntimeSkillRegistry } from './skill-registry'
import { SqliteCheckpointStore, type ResilientSqliteSaver } from './sqlite-checkpointer'

export type LocalRuntimeAdapters = {
  adapters: RuntimeAdapters
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

export function createLocalRuntimeAdapters(options: {
  repositories: SqliteRuntimeRepositories
  checkpointer: ResilientSqliteSaver
  modelGateway: ModelGateway
  clock?: Clock
  idGenerator?: IdGenerator
}): LocalRuntimeAdapters {
  const skillRegistry = new RuntimeSkillRegistry()

  return {
    adapters: {
      graphRunner: new LangGraphRunner(options.modelGateway, skillRegistry, options.checkpointer),
      checkpointStore: new SqliteCheckpointStore(options.checkpointer),
      taskRepository: options.repositories.tasks,
      eventRepository: options.repositories.events,
      modelGateway: options.modelGateway,
      skillRegistry,
      clock: options.clock ?? new SystemClock(),
      idGenerator: options.idGenerator ?? new RandomIdGenerator()
    }
  }
}
