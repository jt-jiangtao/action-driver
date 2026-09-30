import type { RuntimeHost } from './runtime-host'

type SignalSource = {
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
}

export function createNodeRuntimeHost(
  signals: SignalSource = process,
  report: (message: string) => void = (message) => process.stdout.write(`${message}\n`)
): RuntimeHost {
  return {
    ready(descriptor) {
      report(JSON.stringify({ type: 'runtime.ready', ...descriptor }))
    },
    onShutdown(handler) {
      const shutdown = () => {
        signals.off('SIGINT', shutdown)
        signals.off('SIGTERM', shutdown)
        handler()
      }
      signals.on('SIGINT', shutdown)
      signals.on('SIGTERM', shutdown)
    }
  }
}
