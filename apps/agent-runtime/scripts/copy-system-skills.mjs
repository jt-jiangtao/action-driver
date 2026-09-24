import { cp, mkdir } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { join } from 'node:path'

const appRoot = fileURLToPath(new URL('../', import.meta.url))
const source = join(appRoot, 'resources', 'system-skills')
const destination = join(appRoot, 'dist', 'system-skills')
await mkdir(destination, { recursive: true })
await cp(source, destination, { recursive: true, force: true })
