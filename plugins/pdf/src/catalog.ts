import type { PluginCatalog } from '@action-driver/plugin-sdk'
import { skill } from './skill.js'
export const catalog: PluginCatalog = { tools: [], skills: [skill] }
