import { LangGraphRunner } from '@action-driver/agent-runtime/agent-graph'
import type { GraphToolRuntime } from '@action-driver/agent-runtime/agent-graph'
import type { InteractionLogRecorder } from '@action-driver/observability'
import type { ToolExecutionContext } from '@action-driver/runtime-contracts'
import type { Clock, IdGenerator, ModelGateway, RuntimeAdapters, RuntimeRepositories } from '@action-driver/agent-runtime/ports'
import { RuntimeSkillRegistry } from '@action-driver/agent-runtime/skill-registry'
import type { ResilientSqliteSaver } from './sqlite-checkpointer'
import { RuntimeToolRegistry } from '@action-driver/agent-runtime/tool-registry'
import { RuntimeToolPolicy } from '@action-driver/agent-runtime/tool-policy'
import { ToolInvocationService } from '@action-driver/agent-runtime/tool-invocation-service'

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
  repositories: RuntimeRepositories
  checkpointer: ResilientSqliteSaver
  modelGateway: ModelGateway
  clock?: Clock
  idGenerator?: IdGenerator
  interactions?: InteractionLogRecorder
  executionContext?: (taskId: string) => Promise<ToolExecutionContext>
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
      ...(options.executionContext ? { executionContext: options.executionContext } : {}),
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
