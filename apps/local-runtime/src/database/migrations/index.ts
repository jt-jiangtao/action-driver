import type { RuntimeMigration } from './types'
import { migrations1To4 } from './v01-v04'
import { migrations5To8 } from './v05-v08'
import { migrations9To12 } from './v09-v12'
import { migrations13To16 } from './v13-v16'

export type { RuntimeMigration } from './types'

export const DEFAULT_RUNTIME_MIGRATIONS: readonly RuntimeMigration[] = [
  ...migrations1To4,
  ...migrations5To8,
  ...migrations9To12,
  ...migrations13To16
]
