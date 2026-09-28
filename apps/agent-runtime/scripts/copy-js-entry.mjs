import { cp, rm } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

/**
 * The JavaScript entry runs as its own Node process inside the session sandbox, so the child script
 * and the owned CUA bundle must live next to the bundled runtimes.
 */
export async function stageComputerUse(appRoot) {
  await rm(join(appRoot, 'dist', 'vendor'), { recursive: true, force: true })
  await rm(join(appRoot, 'dist', 'js-repl'), { recursive: true, force: true })
  await cp(join(appRoot, 'resources', 'js-repl'), join(appRoot, 'dist', 'js-repl'), {
    recursive: true,
    force: true
  })
  await cp(join(appRoot, '..', '..', 'packages', 'cua', 'resources', 'docs'),
    join(appRoot, 'dist', 'resources', 'docs'), { recursive: true, force: true })
  await cp(join(appRoot, '..', '..', 'packages', 'browser-runtime', 'resources'),
    join(appRoot, 'dist', 'resources'), { recursive: true, force: true })
  await cp(join(appRoot, '..', '..', 'packages', 'browser-desktop', 'resources'),
    join(appRoot, 'dist', 'resources'), { recursive: true, force: true })
  await build({
    entryPoints: [join(appRoot, 'resources', 'js-repl', 'owned-cua.ts')],
    outfile: join(appRoot, 'dist', 'js-repl', 'owned-cua.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    conditions: ['development'],
    external: ['playwright-core', 'chromium-bidi/*']
  })
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (entryPath === fileURLToPath(import.meta.url)) {
  await stageComputerUse(fileURLToPath(new URL('../', import.meta.url)))
}
