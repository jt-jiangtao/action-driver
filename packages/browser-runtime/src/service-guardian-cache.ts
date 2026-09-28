export interface GuardianOrigin {
  threadId: string
  origin: string
}
export interface GuardianApproval {
  expiresAt: number
}
export interface GuardianReview {
  revoked: boolean
}
interface Decision {
  result: unknown
  approval: GuardianApproval | undefined
}
interface Entry {
  approval?: GuardianApproval
  pending?: { review: GuardianReview; decision: Promise<Decision> }
}
export class GuardianOriginCache {
  private threads = new Map<string, Map<string, Entry>>()
  private timer: ReturnType<typeof setTimeout> | undefined
  get(origin: GuardianOrigin | null | undefined) {
    if (!origin) return undefined
    const approval = this.threads.get(origin.threadId)?.get(origin.origin)?.approval
    return approval && approval.expiresAt > Date.now() ? approval : undefined
  }
  record(origin: GuardianOrigin, review?: GuardianReview) {
    if (review?.revoked === true) return
    this.entry(origin).approval = { expiresAt: Date.now() + 300000 }
    this.schedule()
  }
  revoke(origin: GuardianOrigin) {
    const entry = this.threads.get(origin.threadId)?.get(origin.origin)
    if (!entry) return
    delete entry.approval
    if (entry.pending) {
      entry.pending.review.revoked = true
      delete entry.pending
    }
    this.prune(origin, entry)
  }
  start(
    origin: GuardianOrigin,
    expected: GuardianApproval | undefined,
    run: (review: GuardianReview) => unknown
  ): { kind: 'retry' } | { kind: 'review'; shared: boolean; decision: Promise<Decision> } {
    const current = this.get(origin)
    if (current != null && current !== expected) return { kind: 'retry' }
    const entry = this.entry(origin)
    if (entry.pending) return { kind: 'review', shared: true, decision: entry.pending.decision }
    const review = { revoked: false },
      decision = Promise.resolve()
        .then(() => run(review))
        .then((result) => ({ result, approval: entry.approval }))
        .finally(() => {
          if (entry.pending?.decision === decision) {
            delete entry.pending
            this.prune(origin, entry)
          }
        })
    entry.pending = { review, decision }
    return { kind: 'review', shared: false, decision }
  }
  clear() {
    this.threads.clear()
    clearTimeout(this.timer)
    this.timer = undefined
  }
  private entry(origin: GuardianOrigin) {
    let entries = this.threads.get(origin.threadId)
    if (!entries) {
      entries = new Map()
      this.threads.set(origin.threadId, entries)
    }
    let entry = entries.get(origin.origin)
    if (!entry) {
      entry = {}
      entries.set(origin.origin, entry)
    }
    return entry
  }
  private prune(origin: GuardianOrigin, entry: Entry) {
    if (entry.approval && entry.approval.expiresAt <= Date.now()) delete entry.approval
    if (entry.approval || entry.pending) return
    const entries = this.threads.get(origin.threadId)
    if (entries?.get(origin.origin) === entry) {
      entries.delete(origin.origin)
      if (!entries.size) this.threads.delete(origin.threadId)
    }
  }
  private schedule() {
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      for (const [threadId, entries] of this.threads)
        for (const [origin, entry] of entries) this.prune({ threadId, origin }, entry)
      if (this.threads.size) this.schedule()
    }, 300000)
    if (typeof this.timer !== 'number') this.timer.unref()
  }
}
export const guardianOriginCache = new GuardianOriginCache()
