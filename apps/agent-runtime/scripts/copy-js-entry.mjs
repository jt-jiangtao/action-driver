import { cp, rm } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { join, resolve } from 'node:path'

/**
 * The JavaScript entry runs as its own Node process inside the session sandbox, so the child script
 * and the vendored Codex Computer Use tree have to live next to the bundled runtimes rather than
 * inside the bundled runtime file. The vendor tree is copied verbatim: behaviour differences live in
 * the runtime loader hooks, not in patched copies.
 */
export async function stageComputerUse(appRoot) {
  await cp(join(appRoot, 'resources', 'js-repl'), join(appRoot, 'dist', 'js-repl'), {
    recursive: true,
    force: true
  })
  const vendorTarget = join(appRoot, 'dist', 'vendor', 'codex-cua')
  // Mirror instead of merge so files dropped from the vendored tree cannot linger in dist.
  await rm(vendorTarget, { recursive: true, force: true })
  await cp(join(appRoot, 'vendor', 'codex-cua'), vendorTarget, { recursive: true })
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (entryPath === fileURLToPath(import.meta.url)) {
  await stageComputerUse(fileURLToPath(new URL('../', import.meta.url)))
}
