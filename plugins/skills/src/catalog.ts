import type { PluginCatalog } from '@actiondriver/plugin-sdk'
import { skill } from './skill.js'
import { readDefinition, installDefinition } from './definitions.js'
export const catalog: PluginCatalog = { tools: [readDefinition, installDefinition], skills: [skill] }
