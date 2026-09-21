import type { ModelTestState } from '../models/model-connections'
import { ModelTestStatus } from './ui/ModelTestStatus'

export function ModelStatusPill({ state }: { state: ModelTestState }) {
  return <ModelTestStatus state={state} />
}
