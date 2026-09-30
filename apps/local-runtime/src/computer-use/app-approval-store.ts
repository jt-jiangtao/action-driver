import type Database from 'better-sqlite3'

/** Runtime-owned settings. A stored grant never overrides the helper's current policy. */
export class AppApprovalStore {
  constructor(private readonly database: Database.Database) {}

  isAllowed(bundleId: string): boolean {
    return (
      this.database
        .prepare('SELECT 1 FROM computer_app_approvals WHERE bundle_id = ?')
        .get(bundleId) !== undefined
    )
  }

  allow(bundleId: string): void {
    if (!bundleId.trim()) throw new Error('INVALID_REQUEST: empty application bundle identifier')
    this.database
      .prepare(
        'INSERT OR IGNORE INTO computer_app_approvals (bundle_id, approved_at) VALUES (?, ?)'
      )
      .run(bundleId, new Date().toISOString())
  }

  list(): string[] {
    return (
      this.database
        .prepare('SELECT bundle_id FROM computer_app_approvals ORDER BY bundle_id')
        .all() as Array<{ bundle_id: string }>
    ).map((row) => row.bundle_id)
  }

  remove(bundleId: string): void {
    this.database.prepare('DELETE FROM computer_app_approvals WHERE bundle_id = ?').run(bundleId)
  }
}
