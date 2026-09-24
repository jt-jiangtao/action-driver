import { LangGraphRunner } from './agent-graph'
import type { GraphToolRuntime } from './agent-graph'
import type { InteractionLogRecorder } from '@actiondriver/observability'
import type { Clock, IdGenerator, ModelGateway, RuntimeAdapters } from './ports'
import type { SqliteRuntimeRepositories } from './repositories'
import { RuntimeSkillRegistry } from './skill-registry'
import type { ResilientSqliteSaver } from './sqlite-checkpointer'
import { RuntimeToolRegistry } from './tool-registry'
import { RuntimeToolPolicy } from './tool-policy'
import { ToolInvocationService } from './tool-invocation-service'

export type LocalRuntimeAdapters = {
  adapters: RuntimeAdapters
  toolRuntime: GraphToolRuntime
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
  interactions?: InteractionLogRecorder
}): LocalRuntimeAdapters {
  const skillRegistry = new RuntimeSkillRegistry()
  const clock = options.clock ?? new SystemClock()
  const registry = new RuntimeToolRegistry()
  const policy = new RuntimeToolPolicy()
  const toolRuntime: GraphToolRuntime = {
    registry,
    policy,
    invocations: new ToolInvocationService({
      registry,
      policy,
      persistence: options.repositories,
      clock,
      ...(options.interactions ? { interactions: options.interactions } : {})
    }),
    grants: []
  }

  return {
    toolRuntime,
    adapters: {
      graphRunner: new LangGraphRunner(
        options.modelGateway, skillRegistry, options.checkpointer, toolRuntime
      ),
      taskRepository: options.repositories.tasks,
      eventRepository: options.repositories.events,
      modelGateway: options.modelGateway,
      skillRegistry,
      clock,
      idGenerator: options.idGenerator ?? new RandomIdGenerator()
    }
  }
}
