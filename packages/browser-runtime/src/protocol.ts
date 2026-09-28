import { Commands } from './commands/index.js'
import { AtlasCommand } from './command.js'
import type { PayloadParser } from './command.js'
import type { AgentTransport } from './transport.js'
export type ProtocolPayload = Record<string, unknown> | (() => Record<string, unknown>)
export type ProtocolTimeout = number | undefined | (() => number | undefined)
const definitions = Object.fromEntries(
  Object.values(Commands)
    .filter(
      (value): value is Exclude<typeof value, typeof AtlasCommand> => typeof value !== 'function'
    )
    .map((value) => [value.commandType, value])
) as Record<string, { PayloadSchema: PayloadParser<unknown> }>
function command(type: string, payload: Record<string, unknown>) {
  const definition = definitions[type]
  if (!definition) throw new Error(`Unknown browser command: ${type}`)
  return new AtlasCommand(type, definition.PayloadSchema, payload)
}
/** Construct protocol data; public schema commands remain separate. */
export function dispatch(
  transport: AgentTransport,
  type: string,
  payload: ProtocolPayload = {},
  ...timeout: [] | [ProtocolTimeout]
): Promise<unknown> {
  return transport.send({
    command: command(type, typeof payload === 'function' ? payload() : payload),
    ...(timeout.length
      ? { timeoutMs: typeof timeout[0] === 'function' ? timeout[0]() : timeout[0] }
      : {})
  })
}
