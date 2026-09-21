import { Container } from 'inversify'
import { createMockRuntimeAdapters } from './mock-adapters'
import type { RuntimeAdapters } from './ports'

export const RUNTIME_TYPES = {
  graphRunner: Symbol.for('actiondriver.runtime.graph-runner'),
  checkpointStore: Symbol.for('actiondriver.runtime.checkpoint-store'),
  taskRepository: Symbol.for('actiondriver.runtime.task-repository'),
  eventRepository: Symbol.for('actiondriver.runtime.event-repository'),
  modelGateway: Symbol.for('actiondriver.runtime.model-gateway'),
  skillRegistry: Symbol.for('actiondriver.runtime.skill-registry'),
  clock: Symbol.for('actiondriver.runtime.clock'),
  idGenerator: Symbol.for('actiondriver.runtime.id-generator')
} as const

export type RuntimeContainerOptions =
  | { mode: 'mock' }
  | { mode: 'local'; adapters?: RuntimeAdapters }

export function createRuntimeContainer(options: RuntimeContainerOptions): Container {
  const adapters = resolveAdapters(options)
  const container = new Container()

  container.bind(RUNTIME_TYPES.graphRunner).toConstantValue(adapters.graphRunner)
  container.bind(RUNTIME_TYPES.checkpointStore).toConstantValue(adapters.checkpointStore)
  container.bind(RUNTIME_TYPES.taskRepository).toConstantValue(adapters.taskRepository)
  container.bind(RUNTIME_TYPES.eventRepository).toConstantValue(adapters.eventRepository)
  container.bind(RUNTIME_TYPES.modelGateway).toConstantValue(adapters.modelGateway)
  container.bind(RUNTIME_TYPES.skillRegistry).toConstantValue(adapters.skillRegistry)
  container.bind(RUNTIME_TYPES.clock).toConstantValue(adapters.clock)
  container.bind(RUNTIME_TYPES.idGenerator).toConstantValue(adapters.idGenerator)

  return container
}

function resolveAdapters(options: RuntimeContainerOptions): RuntimeAdapters {
  if (options.mode === 'mock') return createMockRuntimeAdapters()
  if (options.adapters) return options.adapters

  throw new Error(
    'Local runtime adapters are required; local mode never falls back to mock adapters'
  )
}
