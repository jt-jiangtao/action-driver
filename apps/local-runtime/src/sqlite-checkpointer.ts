import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { createRuntimeDatabase } from './database'
import { assertPersistablePayload } from './persistence-guard'

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

  override async deleteThread(threadId: string): Promise<void> {
    this.setup()
    await super.deleteThread(threadId)
  }

}

export function createSqliteCheckpointer(path: string): ResilientSqliteSaver {
  return new ResilientSqliteSaver(createRuntimeDatabase(path))
}
