import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const { build } = createRequire(new URL('../apps/local-runtime/package.json', import.meta.url))('esbuild')
const metadata = JSON.parse(await readFile('package.json', 'utf8'))
await build({ entryPoints: Object.values(metadata.exports).map(entry => entry.development.default), outdir: resolve('dist'), outbase: 'src', external: ['jsdom', '@mozilla/readability'], bundle: true, platform: 'node', format: 'esm', loader: { '.md': 'text' } })
