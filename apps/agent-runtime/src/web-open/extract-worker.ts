import { parentPort, workerData } from 'node:worker_threads'
import { extractPageText } from './extract'

type WorkerInput = { html: string; url: string }

try {
  const { html, url } = workerData as WorkerInput
  parentPort?.postMessage({ ok: true, result: extractPageText(html, url) })
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error:
      error instanceof Error && error.message === 'WEB_OPEN_EMPTY_CONTENT'
        ? 'WEB_OPEN_EMPTY_CONTENT'
        : 'WEB_OPEN_PARSE_FAILED'
  })
}
