import { Worker } from 'node:worker_threads'
import type { ExtractedPage } from './extract'

const DEFAULT_PARSE_TIMEOUT_MS = 5_000

export function extractPageTextIsolated(
  html: string,
  url: string,
  options: { signal?: AbortSignal; timeoutMs?: number; workerUrl?: URL } = {}
): Promise<ExtractedPage> {
  if (options.signal?.aborted) return Promise.reject(abortReason(options.signal))
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      options.workerUrl ?? new URL('./web-open-worker.js', import.meta.url),
      {
        workerData: { html, url },
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 2 }
      }
    )
    let settled = false
    const finish = (result: { value?: ExtractedPage; error?: Error }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      void worker.terminate()
      if (result.error) reject(result.error)
      else resolve(result.value!)
    }
    const onAbort = () => finish({ error: abortReason(options.signal!) })
    const timer = setTimeout(
      () => finish({ error: new Error('WEB_OPEN_PARSE_TIMEOUT') }),
      options.timeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS
    )
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) onAbort()
    worker.once('message', (message: { ok: boolean; result?: ExtractedPage; error?: string }) => {
      if (message.ok && message.result) finish({ value: message.result })
      else finish({ error: new Error(message.error ?? 'WEB_OPEN_PARSE_FAILED') })
    })
    worker.once('error', () => finish({ error: new Error('WEB_OPEN_PARSE_FAILED') }))
    worker.once('exit', () => finish({ error: new Error('WEB_OPEN_PARSE_FAILED') }))
  })
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('WEB_OPEN_CANCELLED')
}
