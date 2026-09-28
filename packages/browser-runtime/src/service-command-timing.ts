import { AsyncLocalStorage } from 'node:async_hooks'
interface Retry {
  startedCount: number
  success: { count: number; elapsedMs: number }
  timeout: { count: number; elapsedMs: number }
}
interface Timing {
  startedAt: number
  elapsedElicitationMs: number
  locatorRetry?: Retry
}
export class CommandTiming {
  private active = new AsyncLocalStorage<Timing>()
  startCommand<T>(
    command: T,
    emit: (name: string, command: T, fields: Record<string, unknown>) => unknown
  ) {
    const timing: Timing = { startedAt: performance.now(), elapsedElicitationMs: 0 }
    return {
      finish: (outcome: string) => {
        const retry = timing.locatorRetry
        emit('browser_use_agent_command', command, {
          duration_ms: Math.round(
            Math.max(0, performance.now() - timing.startedAt - timing.elapsedElicitationMs)
          ),
          outcome,
          ...(retry == null
            ? {}
            : {
                locator_retry_started_count: retry.startedCount,
                locator_retry_success_count: retry.success.count,
                locator_retry_success_elapsed_ms: Math.round(retry.success.elapsedMs),
                locator_retry_timeout_count: retry.timeout.count,
                locator_retry_timeout_elapsed_ms: Math.round(retry.timeout.elapsedMs)
              })
        })
      },
      run: async <R>(run: () => Promise<R>) => await this.active.run(timing, run)
    }
  }
  startLocatorRetry() {
    const timing = this.active.getStore()
    let startedAt: number | undefined,
      finished = false
    return {
      attemptFailed: () => {
        if (finished || timing == null || startedAt != null) return
        startedAt = performance.now()
        timing.locatorRetry ??= {
          startedCount: 0,
          success: { count: 0, elapsedMs: 0 },
          timeout: { count: 0, elapsedMs: 0 }
        }
        timing.locatorRetry.startedCount++
      },
      finish: (outcome: 'success' | 'timeout') => {
        if (finished) return
        finished = true
        if (timing?.locatorRetry == null || startedAt == null) return
        timing.locatorRetry[outcome].count++
        timing.locatorRetry[outcome].elapsedMs += performance.now() - startedAt
      }
    }
  }
  trackElicitation<T, R>(run: (value: T) => Promise<R>) {
    return async (value: T) => {
      const timing = this.active.getStore()
      if (timing == null) return await run(value)
      const startedAt = performance.now()
      try {
        return await run(value)
      } finally {
        timing.elapsedElicitationMs += performance.now() - startedAt
      }
    }
  }
}
