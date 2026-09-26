import { cp } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { join } from 'node:path'

// The JavaScript entry runs as its own Node process inside the session sandbox, so the child script
// has to live next to the bundled runtimes rather than inside the bundled runtime file.
const appRoot = fileURLToPath(new URL('../', import.meta.url))
await cp(join(appRoot, 'resources', 'js-repl'), join(appRoot, 'dist', 'js-repl'), {
  recursive: true,
  force: true
})
