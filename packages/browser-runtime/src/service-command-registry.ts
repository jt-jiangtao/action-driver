import { tabCommandHandlers } from './service-tab-commands.js'
import { interactionCommandHandlers } from './service-tab-interaction-commands.js'
import { playwrightCommandHandlers } from './service-playwright-commands.js'
import { cuaCommandHandlers } from './service-cua-commands.js'
import { axCommandHandlers } from './service-ax-commands.js'
import { webMcpCommandHandlers } from './service-webmcp.js'
import { extraCommandHandlers } from './service-extra-commands.js'
import { cdpCommandHandlers } from './service-cdp-commands.js'
import { miscCommandHandlers } from './service-misc-commands.js'
import { contentExportHandlers } from './service-content-export.js'
import { authCommandHandlers } from './service-auth-registry.js'

type Handler = (...args: any[]) => Promise<unknown>
type HandlerGroup = Record<string, Handler>

/** Register implemented browser commands without pretending unsupported commands are restored. */
export function createCommandRegistry(...additional: HandlerGroup[]): HandlerGroup {
  const result: HandlerGroup = Object.create(null)
  for (const group of [
    tabCommandHandlers,
    interactionCommandHandlers,
    playwrightCommandHandlers,
    cuaCommandHandlers,
    axCommandHandlers,
    webMcpCommandHandlers,
    extraCommandHandlers,
    cdpCommandHandlers,
    miscCommandHandlers,
    contentExportHandlers,
    authCommandHandlers,
    ...additional
  ])
    for (const [name, handler] of Object.entries(group)) {
      if (Object.hasOwn(result, name)) throw Error(`Duplicate browser command: ${name}`)
      result[name] = handler as Handler
    }
  return result
}
