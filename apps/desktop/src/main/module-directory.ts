import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolveModuleDirectory(moduleUrl: string): string {
  return dirname(fileURLToPath(moduleUrl))
}
