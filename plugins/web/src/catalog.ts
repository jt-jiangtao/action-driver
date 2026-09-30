import type { PluginCatalog } from '@action-driver/plugin-sdk'
import { catalog as search } from './search/catalog.js'
import { catalog as reader } from './reader/catalog.js'
export const catalog: PluginCatalog = { tools: [...search.tools, ...reader.tools], skills: [] }
