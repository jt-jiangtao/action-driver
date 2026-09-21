import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { assertPersistablePayload } from './persistence-guard'
import type { CheckpointStore } from './ports'

export class ResilientSqliteSaver extends SqliteSaver {
  override async put(
    ...args: Parameters<SqliteSaver['put']>
  ): Promise<Awaited<ReturnType<SqliteSaver['put']>>> {
    this.setup()
    const [, checkpoint, metadata] = args
    assertPersistablePayload(checkpoint.channel_values, 'checkpoint.channel_values')
    assertPersistablePayload(metadata, 'checkpoint.metadata')
    return super.put(...args)
  }

  override async putWrites(
    ...args: Parameters<SqliteSaver['putWrites']>
  ): Promise<Awaited<ReturnType<SqliteSaver['putWrites']>>> {
    this.setup()
    const [, writes] = args
    writes.forEach(([channel, value]) =>
      assertPersistablePayload(value, `checkpoint.pendingWrites.${channel}`)
    )
    return super.putWrites(...args)
  }

  listThreadIds(): string[] {
    this.setup()
    return (
      this.db
        .prepare(
          `SELECT DISTINCT thread_id FROM checkpoints
           WHERE checkpoint IS NOT NULL AND metadata IS NOT NULL
           ORDER BY thread_id`
        )
        .all() as { thread_id: string }[]
    ).map((row) => row.thread_id)
  }

  override async getTuple(
    config: Parameters<SqliteSaver['getTuple']>[0]
  ): Promise<Awaited<ReturnType<SqliteSaver['getTuple']>>> {
    const requestedCheckpointId = config.configurable?.checkpoint_id
    if (requestedCheckpointId) return this.tryGetTuple(config)

    this.setup()
    const threadId = config.configurable?.thread_id
    const checkpointNamespace = config.configurable?.checkpoint_ns ?? ''
    const candidates = this.db
      .prepare(
        `SELECT checkpoint_id FROM checkpoints
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint IS NOT NULL AND metadata IS NOT NULL
         ORDER BY checkpoint_id DESC`
      )
      .all(threadId, checkpointNamespace) as { checkpoint_id: string }[]

    for (const candidate of candidates) {
      const tuple = await this.tryGetTuple({
        ...config,
        configurable: {
          ...config.configurable,
          thread_id: threadId,
          checkpoint_ns: checkpointNamespace,
          checkpoint_id: candidate.checkpoint_id
        }
      })
      if (tuple) return tuple
    }

    return undefined
  }

  private async tryGetTuple(
    config: Parameters<SqliteSaver['getTuple']>[0]
  ): Promise<Awaited<ReturnType<SqliteSaver['getTuple']>>> {
    try {
      return await super.getTuple(config)
    } catch {
      return undefined
    }
  }

  close(): void {
    this.db.close()
  }
}

export class SqliteCheckpointStore implements CheckpointStore {
  private sequence = 0

  constructor(private readonly saver: ResilientSqliteSaver) {}

  async get(threadId: string): Promise<unknown | null> {
    const tuple = await this.saver.getTuple({
      configurable: { thread_id: threadId, checkpoint_ns: 'actiondriver-port' }
    })
    return tuple?.checkpoint.channel_values.actiondriver ?? null
  }

  async put(threadId: string, checkpoint: unknown): Promise<void> {
    assertPersistablePayload(checkpoint, 'checkpoint.value')
    this.sequence += 1
    const timestamp = new Date().toISOString()
    const checkpointId = `${Date.now().toString().padStart(16, '0')}-${this.sequence
      .toString()
      .padStart(8, '0')}`
    await this.saver.put(
      { configurable: { thread_id: threadId, checkpoint_ns: 'actiondriver-port' } },
      {
        v: 4,
        id: checkpointId,
        ts: timestamp,
        channel_values: { actiondriver: checkpoint },
        channel_versions: { actiondriver: this.sequence },
        versions_seen: {}
      },
      { source: 'update', step: this.sequence, parents: {} }
    )
  }
}

export function createSqliteCheckpointer(path: string): ResilientSqliteSaver {
  mkdirSync(dirname(path), { recursive: true })
  return new ResilientSqliteSaver(new Database(path))
}
