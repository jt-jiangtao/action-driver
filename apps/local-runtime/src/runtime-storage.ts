import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createInteractionLogRecorder } from '@action-driver/observability'
import { openRuntimeDatabase } from './database'
import { claimRuntimeOwnership } from './runtime-ownership'
import { SqliteRuntimeRepositories } from './repositories'
import { RolloutSessionStore } from './rollout/session-store'
import { RolloutRuntimeRepositories } from './rollout/runtime-repositories'
import { SessionAssetStore } from './media/session-asset-store'
import { VolatileComputerImages } from './computer-use/volatile-images'
import { SessionWorkspaceStore, sessionWorkspacePaths } from './execution/session-workspace'
import { SessionInputFileStore } from './media/session-input-file-store'
import { SessionOutputStore } from './media/session-output-store'
import {
  createRuntimeResourceRegistryFromStores,
  parseRemoteResourceHosts
} from './resources/runtime-resources'
import { createSqliteCheckpointer } from './sqlite-checkpointer'
import { createServiceLogger } from './service/logger'
import { ModelConnectionService } from './model-connections/service'
import { createFileModelConnectionStore } from './model-connections/file-store'
import { createCredentialCipher, createCredentialKey } from './model-connections/credential-cipher'
import { createFetchHttpTransport } from '@action-driver/model-provider-runtime/http-transport'

export async function createRuntimeStorage(options: {
  dataRoot: string
  workspaceRoot: string
  environment?: NodeJS.ProcessEnv
}) {
  const { dataRoot, workspaceRoot } = options
  const environment = options.environment ?? process.env
  // The session log and its projection replaced the single business database; drop the old file
  // so a stale schema can never be read, and keep auxiliary state in its own database.
  for (const suffix of ['', '-wal', '-shm'])
    rmSync(join(dataRoot, `action-driver.db${suffix}`), { force: true })
  const statePath = join(dataRoot, 'state.sqlite')
  const database = openRuntimeDatabase(statePath)
  const releases: Array<() => void | Promise<void>> = [
    () => {
      database.close()
    }
  ]
  let closed = false
  let clearSessionResources: (sessionId: string) => Promise<void> = async () => undefined
  const close = async () => {
    if (closed) return
    closed = true
    const failures: unknown[] = []
    for (const release of releases.reverse()) {
      try {
        await release()
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) throw new AggregateError(failures, 'RUNTIME_STORAGE_CLOSE_FAILED')
  }
  try {
    const ownership = claimRuntimeOwnership(database)
    releases.push(() => ownership.release())
    const stateRepositories = new SqliteRuntimeRepositories(database)
    const checkpointer = createSqliteCheckpointer(join(dataRoot, 'checkpoints.sqlite'))
    releases.push(() => checkpointer.close())
    // Session history now lives in an append-only rollout log; the state database keeps the
    // auxiliary stores (input files, assets, outputs, approvals, ownership).
    const rolloutStore = new RolloutSessionStore({
      sessionsRoot: dataRoot,
      statePath: join(dataRoot, 'rollout-state.sqlite'),
      historyPath: join(dataRoot, 'rollout-history.sqlite'),
      onDeleteSession: async (sessionId, taskIds) => {
        const removeRecords = database.transaction(() => {
          for (const table of ['session_assets', 'session_input_files', 'task_output_files'])
            database.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId)
          for (const taskId of taskIds)
            for (const table of ['steps', 'skill_invocations', 'runtime_events'])
              database.prepare(`DELETE FROM ${table} WHERE task_id = ?`).run(taskId)
        })
        removeRecords()
        await checkpointer.deleteThread(sessionId)
        await Promise.all([
          rm(join(dataRoot, 'sessions', sessionId), { recursive: true, force: true }),
          rm(join(dataRoot, 'outputs', sessionId), { recursive: true, force: true }),
          rm(sessionWorkspacePaths(workspaceRoot, sessionId).root, { recursive: true, force: true })
        ])
        await clearSessionResources(sessionId)
      }
    })
    releases.push(() => rolloutStore.close())
    const repositories = new RolloutRuntimeRepositories(rolloutStore, stateRepositories)
    const assets = new SessionAssetStore({ database, rootDirectory: dataRoot })
    const computerImages = new VolatileComputerImages()
    const workspaces = new SessionWorkspaceStore({ workspaceRoot })
    const inputFiles = new SessionInputFileStore({
      database,
      rootDirectory: dataRoot,
      workspaces
    })
    const outputs = new SessionOutputStore({
      database,
      rootDirectory: dataRoot,
      workspaces
    })
    // Unified resource entry point: session inputs and registered deliverables are served only
    // through their owning provider, which re-checks the persisted ownership records.
    const resources = createRuntimeResourceRegistryFromStores({
      inputFiles,
      inputFileRecords: repositories.inputFiles,
      outputs,
      resourceRoot: join(dataRoot, 'resources'),
      remote: parseRemoteResourceHosts(environment)
    })
    clearSessionResources = async (sessionId) => {
      await Promise.all([
        resources.workStore.deleteSession(sessionId, 'workspace'),
        resources.pluginStore.deleteSession(sessionId, 'plugin')
      ])
    }
    const resourceRegistry = resources.registry
    await assets.cleanExpiredStaged(24 * 60 * 60 * 1000)
    await assets.cleanOrphanFiles()
    await repositories.recoverInterruptedRequests('RUNTIME_RESTARTED')
    const logging = createServiceLogger({ databasePath: statePath })
    releases.push(() => logging.close())
    const interactions = createInteractionLogRecorder({
      ids: {
        eventId: () => `service:${randomUUID()}`,
        correlationId: randomUUID
      },
      logger: logging.logger,
      tracer: logging.tracer,
      meter: logging.meter
    })
    const credentialSecret = environment.ACTION_DRIVER_CREDENTIAL_KEY?.trim()
    const service = new ModelConnectionService({
      store: createFileModelConnectionStore({ filePath: join(dataRoot, 'model-connections.json') }),
      cipher: createCredentialCipher(
        credentialSecret ? createCredentialKey(credentialSecret) : Buffer.alloc(0)
      ),
      transport: createFetchHttpTransport(),
      imageResolver: (asset) =>
        asset.assetId.startsWith('volatile-computer:')
          ? Promise.resolve(computerImages.read(asset))
          : assets.read(asset.assetId, asset.sessionId)
    })
    return {
      database,
      repositories,
      assets,
      computerImages,
      workspaces,
      inputFiles,
      outputs,
      resources,
      resourceRegistry,
      checkpointer,
      logging,
      interactions,
      service,
      close
    }
  } catch (error) {
    await close().catch(() => undefined)
    throw error
  }
}
