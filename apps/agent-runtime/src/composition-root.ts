import { createMockRuntimeAdapters } from './mock-adapters'
import type { RuntimeAdapters } from './ports'

export type RuntimeServicesOptions =
  | { mode: 'mock' }
  | { mode: 'local'; adapters?: RuntimeAdapters }

/** Production and tests receive the same explicit ports. */
export function createRuntimeServices(options: RuntimeServicesOptions): RuntimeAdapters {
  if (options.mode === 'mock') return createMockRuntimeAdapters()
  if (options.adapters) return options.adapters
  throw new Error('Local runtime adapters are required; local mode never falls back to mock adapters')
}
