import type Database from 'better-sqlite3'
import type { PersistedToolInvocation } from '../ports'
import { assertPersistablePayload } from '../persistence-guard'
import { nullableJson, parseNullableJson } from './json-columns'

export function saveToolInvocation(
  database: Database.Database,
  invocation: PersistedToolInvocation
): void {
  assertPersistablePayload(invocation.input, 'toolInvocation.input')
  assertPersistablePayload(invocation.output, 'toolInvocation.output')
  assertPersistablePayload(invocation.error, 'toolInvocation.error')
  database
    .prepare(
      `INSERT INTO tool_invocations
        (id, provider_call_id, task_id, tool_id, tool_version, arguments_hash, decision, status,
         input_json, output_json, error_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET decision = excluded.decision, status = excluded.status,
        output_json = excluded.output_json, error_json = excluded.error_json,
        updated_at = excluded.updated_at`
    )
    .run(
      invocation.id,
      invocation.providerCallId,
      invocation.taskId,
      invocation.toolId,
      invocation.toolVersion,
      invocation.argumentsHash,
      invocation.decision,
      invocation.status,
      JSON.stringify(invocation.input),
      nullableJson(invocation.output),
      nullableJson(invocation.error),
      invocation.createdAt,
      invocation.updatedAt
    )
}

export function toolInvocationFromRow(row: ToolInvocationRow): PersistedToolInvocation {
  return {
    id: row.id,
    providerCallId: row.provider_call_id,
    taskId: row.task_id,
    toolId: row.tool_id,
    toolVersion: row.tool_version,
    argumentsHash: row.arguments_hash,
    decision: row.decision,
    status: row.status,
    input: JSON.parse(row.input_json) as unknown,
    output: parseNullableJson(row.output_json),
    error: parseNullableJson(row.error_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function createToolStore(database: Database.Database) {
  return {
    toolInvocations: {
      save: async (invocation: PersistedToolInvocation): Promise<void> => {
        saveToolInvocation(database, invocation)
      },
      listByTask: async (taskId: string): Promise<PersistedToolInvocation[]> =>
        (
          database
            .prepare('SELECT * FROM tool_invocations WHERE task_id = ? ORDER BY created_at, id')
            .all(taskId) as ToolInvocationRow[]
        ).map(toolInvocationFromRow)
    }
  }
}

export type ToolInvocationRow = {
  id: string
  provider_call_id: string
  task_id: string
  tool_id: string
  tool_version: number
  arguments_hash: string
  decision: PersistedToolInvocation['decision']
  status: PersistedToolInvocation['status']
  input_json: string
  output_json: string | null
  error_json: string | null
  created_at: string
  updated_at: string
}
