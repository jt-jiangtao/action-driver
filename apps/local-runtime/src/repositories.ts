import type Database from 'better-sqlite3'
import type { RuntimeEventRecord, RuntimeTaskRecord } from '@action-driver/agent-runtime/ports'

export type { PersistedMessage, PersistedStreamRequest, PersistedToolInvocation } from '@action-driver/agent-runtime/ports'
import { createInputFileStore } from './persistence/input-file-store'
import { createStreamStore, appendEvent } from './persistence/stream-store'
import {
  createTaskStore,
  saveSkillInvocation,
  saveTask
} from './persistence/task-store'
import type { PersistedSkillInvocation } from './persistence/task-store'

export type { PersistedSkillInvocation, PersistedStep } from './persistence/task-store'

/**
 * Composition entry for the SQLite persistence layer. Domain stores below share this single
 * connection; aggregate and cross-table writes stay in this class so each one runs inside one
 * `database.transaction(...).immediate()` boundary.
 */
export class SqliteRuntimeRepositories {
  readonly inputFiles
  readonly steps
  readonly skillInvocations
  readonly events

  constructor(private readonly database: Database.Database) {
    const taskStore = createTaskStore(database)
    const streamStore = createStreamStore(database)
    const inputFileStore = createInputFileStore(database)
    this.steps = taskStore.steps
    this.skillInvocations = taskStore.skillInvocations
    this.events = streamStore.events
    this.inputFiles = inputFileStore.inputFiles
  }







  async commitTaskStateWithEvent(
    task: RuntimeTaskRecord,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord> {
    return this.database
      .transaction(() => {
        saveTask(this.database, task)
        return appendEvent(this.database, event)
      })
      .immediate()
  }

  async commitSkillInvocationWithEvent(
    invocation: PersistedSkillInvocation,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord> {
    return this.database
      .transaction(() => {
        saveSkillInvocation(this.database, invocation)
        return appendEvent(this.database, event)
      })
      .immediate()
  }


  close(): void {
    this.database.close()
  }
}
