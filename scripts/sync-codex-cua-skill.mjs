import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Copies every Skill resource; only the entry document receives the approved current interface. */
export function syncComputerUseSkill({ sourceDirectory, documentsDirectory, destinationDirectory }) {
  // Read and validate before replacing the destination, so an unavailable source is non-destructive.
  readFileSync(join(sourceDirectory, 'SKILL.md'))
  const body = readFileSync(join(documentsDirectory, 'tinysky-alt-core-cua-repl.md'), 'utf8')
  if (!statSync(sourceDirectory).isDirectory() || !statSync(documentsDirectory).isDirectory()) {
    throw new Error('Skill and document sources must be directories')
  }
  const source = resolve(sourceDirectory)
  const destination = resolve(destinationDirectory)
  if (source === destination || source.startsWith(destination + '/') || destination.startsWith(source + '/')) {
    throw new Error('Skill source and destination must not overlap')
  }
  if (existsSync(join(sourceDirectory, 'codex-docs'))) {
    throw new Error('Source Skill already owns codex-docs; refusing to overwrite its resources')
  }
  const metadata = '---\nname: computer-use\ndescription: Control local Mac apps through Computer Use for tasks that require reading or operating app UI. Prefer purpose-built connectors, APIs, or CLIs when available.\n---\n\n'
  rmSync(destinationDirectory, { recursive: true, force: true })
  mkdirSync(dirname(destinationDirectory), { recursive: true })
  cpSync(sourceDirectory, destinationDirectory, { recursive: true })
  cpSync(documentsDirectory, join(destinationDirectory, 'codex-docs'), { recursive: true })
  writeFileSync(join(destinationDirectory, 'SKILL.md'), metadata + '## Action-Driver tool entry\n\nUse `tools_local_computer_use_js` to execute CUA code and `tools_local_computer_use_reset` to reset it. Read this Skill first with `tools_local_skills_read`. Upstream references to cua_repl are the underlying API, not an additional model tool.\n\n' + body)
}
