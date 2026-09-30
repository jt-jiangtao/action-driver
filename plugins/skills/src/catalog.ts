import type { PluginCatalog } from '@action-driver/plugin-sdk'
import { skill } from './skill.js'
import { readDefinition, installDefinition } from './definitions.js'
export const catalog: PluginCatalog = { tools: [readDefinition, installDefinition], skills: [skill] }
