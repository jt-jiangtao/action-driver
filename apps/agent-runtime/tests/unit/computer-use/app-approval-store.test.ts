import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openRuntimeDatabase } from '../../../src/database'
import { AppApprovalStore } from '../../../src/computer-use/app-approval-store'

describe('AppApprovalStore', () => {
  it('retains always approvals across runtime restart and supports revocation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'actiondriver-app-approvals-'))
    const path = join(directory, 'runtime.sqlite')
    let database = openRuntimeDatabase(path)
    try {
      const first = new AppApprovalStore(database)
      expect(first.isAllowed('com.apple.Notes')).toBe(false)
      first.allow('com.apple.Notes')
      first.allow('com.apple.Notes')
      database.close()
      database = openRuntimeDatabase(path)
      const second = new AppApprovalStore(database)
      expect(second.isAllowed('com.apple.Notes')).toBe(true)
      expect(second.list()).toEqual(['com.apple.Notes'])
      second.remove('com.apple.Notes')
      expect(second.isAllowed('com.apple.Notes')).toBe(false)
      expect(second.list()).toEqual([])
    } finally {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
