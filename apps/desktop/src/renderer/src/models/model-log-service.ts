import type { ModelLogSession } from './model-logs'

export interface ModelLogService {
  list(): Promise<ModelLogSession[]>
}
