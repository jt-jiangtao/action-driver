export interface AgentCommand {
  toJSON(): Record<string, unknown>
}
export interface TransportRequest {
  command: AgentCommand
  timeoutMs?: number | undefined
}
export interface AgentTransport {
  send(request: TransportRequest): Promise<unknown>
  display(value: unknown): Promise<void>
}
interface TransportOptions {
  executeAgentCommand: (input: Record<string, unknown>) => Promise<unknown>
  displaySideEffect?: (value: unknown) => void | Promise<void>
}
async function defaultDisplay(value: unknown): Promise<void> {
  const display = (globalThis as typeof globalThis & { display?: (value: unknown) => unknown })
    .display
  if (typeof display === 'function') await display(value)
  else console.log(value)
}
export class FunctionAgentTransport implements AgentTransport {
  readonly executeAgentCommand: TransportOptions['executeAgentCommand']
  readonly displaySideEffect: NonNullable<TransportOptions['displaySideEffect']>
  constructor(options: TransportOptions) {
    if (typeof options?.executeAgentCommand !== 'function')
      throw new Error('FunctionAgentTransport requires an executeAgentCommand function')
    this.executeAgentCommand = options.executeAgentCommand
    this.displaySideEffect = options.displaySideEffect ?? defaultDisplay
  }
  async display(value: unknown): Promise<void> {
    await this.displaySideEffect(value)
  }
  async send({ command, timeoutMs }: TransportRequest): Promise<unknown> {
    let response = await this.executeAgentCommand({
      ...command.toJSON(),
      client_timeout_ms: typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : undefined
    })
    if (
      typeof response === 'object' &&
      response !== null &&
      !Array.isArray(response) &&
      !(response instanceof Date) &&
      !(response instanceof Map) &&
      !(response instanceof Set) &&
      !(
        typeof Reflect.get(response, 'then') === 'function' &&
        typeof Reflect.get(response, 'catch') === 'function'
      )
    ) {
      const effects = Reflect.get(response, 'side_effects')
      if (
        Array.isArray(effects) &&
        Array.from(effects).every((effect) => typeof effect === 'string')
      ) {
        const effectSnapshot = Array.from(effects)
        const result: Record<string, unknown> = {}
        // Preserve the validated envelope before asynchronous display callbacks run.
        // Passthrough fields include inherited enumerable strings, but not symbols.
        for (const key in response) {
          if (key === 'side_effects' || key === '__proto__') continue
          const value = Reflect.get(response, key)
          if (value !== undefined) result[key] = value
        }
        for (const effect of effectSnapshot) await this.displaySideEffect(effect)
        response = result
      }
    }
    if (response == null) throw new Error('transport send returned empty response')
    return response
  }
}
