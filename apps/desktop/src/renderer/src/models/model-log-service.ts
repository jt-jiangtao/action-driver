import type { ModelLogSession } from './model-logs'
import type { DetailBounds } from '../../../shared/detail-bounds'

export interface ModelLogService {
  list(): Promise<ModelLogSession[]>
  openDetail(url: string, bounds: DetailBounds): Promise<void>
  setDetailBounds(bounds: DetailBounds): Promise<void>
  closeDetail(): Promise<void>
}
