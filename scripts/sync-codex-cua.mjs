#!/usr/bin/env node
// Re-copies the Codex Computer Use JavaScript packages from the local ChatGPT/Codex app into
// apps/agent-runtime/vendor/codex-cua. Internal use only: these files are proprietary and must not
// ship in a release build. The copy is verbatim; behaviour differences live in the runtime loader hooks.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { syncComputerUseSkill } from './sync-codex-cua-skill.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = process.argv[2] ??
  '/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai'
const target = join(root, 'apps/agent-runtime/vendor/codex-cua/@oai')
const skillSource = process.argv[3] ?? join(homedir(), '.codex/.tmp/bundled-marketplaces/openai-bundled/plugins/computer-use/skills/computer-use')
const vendoredSkill = join(root, 'apps/agent-runtime/vendor/codex-cua/skills/computer-use')

const plan = {
  sky: ['package.json', 'dist', 'docs'],
  cua: ['package.json', 'docs', 'dist'],
  'cua-repl': ['package.json', 'README.md', 'instructions', 'dist', 'plugin']
}
// Out of scope: the browser surface and every native binary (we use our own helper).
const excluded = [join('cua', 'dist', 'lib', 'js', 'oai_js_browser')]

if (!existsSync(source)) {
  console.error(`Codex packages not found at ${source}`)
  process.exit(1)
}
// Confirm both sources before replacing any vendored files.
readFileSync(join(skillSource, 'SKILL.md'))
readFileSync(join(source, 'cua/docs/tinysky-alt-core-cua-repl.md'))
for (const [name, entries] of Object.entries(plan)) {
  const from = join(source, name)
  const to = join(target, name)
  rmSync(to, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })
  for (const entry of entries) {
    cpSync(join(from, entry), join(to, entry), {
      recursive: true,
      filter: (path) => {
        const rel = relative(source, path)
        return !excluded.some((prefix) => rel === prefix || rel.startsWith(prefix + sep))
      }
    })
  }
  const version = JSON.parse(readFileSync(join(to, 'package.json'), 'utf8')).version
  console.log(`@oai/${name}@${version} -> ${relative(root, to)}`)
}
// Preserve the complete original Skill directory in vendor, including future references and assets.
rmSync(vendoredSkill, { recursive: true, force: true })
mkdirSync(dirname(vendoredSkill), { recursive: true })
cpSync(skillSource, vendoredSkill, { recursive: true })
syncComputerUseSkill({
  sourceDirectory: vendoredSkill,
  documentsDirectory: join(target, 'cua/docs'),
  destinationDirectory: join(root, 'plugins/computer-use/skills/computer-use')
})
// Keep the pure catalog snapshot synchronized with its same-package instructions.
const instructionFiles = { description: 'macos/description', disabledBrowser: 'browser-disabled', computer: 'macos/computer', output: 'macos/output', reset: 'reset', codeDescription: 'code' }
const instructions = Object.fromEntries(Object.entries(instructionFiles).map(([key, file]) => [key, readFileSync(join(target, 'cua-repl/instructions', file + '.md'), 'utf8').trimEnd()]))
const { writeFileSync } = await import('node:fs')
mkdirSync(join(root, 'plugins/computer-use/instructions'), { recursive: true })
for (const [key, content] of Object.entries(instructions)) writeFileSync(join(root, 'plugins/computer-use/instructions', key + '.md'), content)
writeFileSync(join(root, 'plugins/computer-use/src/instructions.ts'), '// Verbatim OpenAI instruction snapshots; see ../SOURCE.md.\n' + Object.keys(instructions).map(key => `import ${key} from '../instructions/${key}.md?raw'\n`).join('') + "export { default as skillContent } from '../skills/computer-use/SKILL.md?raw'\nexport const instructions = { " + Object.keys(instructions).join(', ') + ' }\n')
console.log('Complete Computer Use Skill directory copied; current cua_repl body unchanged.')
console.log('Update vendor/codex-cua/SOURCE.md with the source app version and date.')
