import { cp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { join } from 'node:path'

const appRoot = fileURLToPath(new URL('../', import.meta.url))
const source = join(appRoot, 'resources', 'system-skills')
const destination = join(appRoot, 'dist', 'system-skills')
await mkdir(destination, { recursive: true })
for (const id of ['browser-tools', 'computer-tools', 'report-writer', 'computer-use']) {
  await rm(join(destination, id), { recursive: true, force: true })
}
await cp(source, destination, { recursive: true, force: true })

// The main prompt is a local resource too, seeded into the agent home on first run.
await cp(join(appRoot, 'resources', 'prompts'), join(appRoot, 'dist', 'prompts'), {
  recursive: true,
  force: true
})
