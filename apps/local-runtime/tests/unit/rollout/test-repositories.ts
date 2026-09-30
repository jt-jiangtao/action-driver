import { join } from 'node:path'
import { SqliteRuntimeRepositories, openRuntimeDatabase } from '../../../src/index'
import { RolloutSessionStore } from '../../../src/rollout/session-store'

/**
 * Test composition for the post-migration layout: session history comes from the rollout log,
 * while session input files and skill invocations stay in the state database.
 */
export function createTestRepositories(root: string) {
  const state = new SqliteRuntimeRepositories(openRuntimeDatabase(join(root, 'state.sqlite')))
  const rollout = new RolloutSessionStore({
    sessionsRoot: root,
    statePath: join(root, 'rollout-state.sqlite'),
    historyPath: join(root, 'rollout-history.sqlite')
  })
  return Object.assign(rollout, {
    inputFiles: state.inputFiles,
    skillInvocations: state.skillInvocations,
    // Skill invocations keep their own event log in the state database.
    events: state.events,
    commitSkillInvocationWithEvent: state.commitSkillInvocationWithEvent.bind(state)
  })
}

export type TestRepositories = ReturnType<typeof createTestRepositories>
