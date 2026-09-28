import { getState } from './discovery.js'
import type { ComputerDiscovery, BrowserProvider } from './discovery.js'
interface LegacyAgent {
  browsers: BrowserProvider
  documentation: unknown
}
export interface LegacyCUAFacade<Computer, Browser, Documentation> {
  initialize(): ReturnType<typeof getState>
  computer: Computer | null
  browsers: Browser | null
  documentation: Documentation | null
}
/** Original low-level CUA lifecycle; concrete default backend loaders remain separate. */
export function createLegacyCUAFacade<
  Computer extends ComputerDiscovery,
  Agent extends LegacyAgent
>({
  setupBrowser,
  computer
}: {
  setupBrowser: (options: { undocumentedApiMembers: string[] }) => Promise<Agent>
  computer: Computer
}): LegacyCUAFacade<Computer, Agent['browsers'], Agent['documentation']> {
  const facade: LegacyCUAFacade<Computer, Agent['browsers'], Agent['documentation']> = {
    initialize: async function () {
      const agent = await setupBrowser({ undocumentedApiMembers: ['Tab.ax'] })
      facade.computer = computer
      facade.browsers = agent.browsers
      facade.documentation = agent.documentation
      return getState({ browsers: agent.browsers, computer })
    },
    computer: null,
    browsers: null,
    documentation: null
  }
  return facade
}
