import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, cp, lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const parts = ['bin', 'native', 'node', 'python']
const executables = ['bin/override/soffice', 'bin/override/pdftoppm', 'node/bin/node', 'python/bin/python3']

export async function stageOfficeDependencies(source, destination) {
  for (const part of parts) {
    try {
      if (!(await lstat(join(source, part))).isDirectory()) throw new Error('not a directory')
    } catch {
      throw new Error(`OFFICE_DEPENDENCIES_SOURCE_UNAVAILABLE: ${join(source, part)}`)
    }
  }
  for (const relativePath of executables) {
    try { await access(join(source, relativePath), constants.X_OK) }
    catch { throw new Error(`OFFICE_DEPENDENCIES_SOURCE_UNAVAILABLE: ${join(source, relativePath)}`) }
  }

  await mkdir(dirname(destination), { recursive: true })
  const staged = await mkdtemp(join(dirname(destination), '.office-dependencies-'))
  const backup = `${destination}.${randomUUID()}.old`
  let backedUp = false
  try {
    for (const part of parts) {
      await cp(join(source, part), join(staged, part), {
        recursive: true, dereference: false, verbatimSymlinks: true
      })
    }
    for (const relativePath of executables) {
      await access(join(staged, relativePath), constants.X_OK)
    }
    try {
      await rename(destination, backup)
      backedUp = true
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    try { await rename(staged, destination) }
    catch (error) {
      if (backedUp) await rename(backup, destination)
      throw error
    }
    if (backedUp) await rm(backup, { recursive: true, force: true })
  } finally {
    await rm(staged, { recursive: true, force: true })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const source = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies')
  await stageOfficeDependencies(source, join(root, 'dist', 'dependencies'))
}
