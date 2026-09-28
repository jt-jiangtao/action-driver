import { sky } from '@actiondriver/sky'
import { setupBrowserRuntime } from '@actiondriver/browser-runtime'
import { createLegacyCUAFacade } from './legacy-facade.js'
import type { LegacyCUAFacade } from './legacy-facade.js'
type DefaultAgent = Awaited<ReturnType<typeof setupBrowserRuntime>>
export const cua: LegacyCUAFacade<
  typeof sky,
  DefaultAgent['browsers'],
  DefaultAgent['documentation']
> = createLegacyCUAFacade({ computer: sky, setupBrowser: setupBrowserRuntime })
