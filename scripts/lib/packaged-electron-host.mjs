import { access, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { resolveElectronFork } from './electron-fork.mjs'

const exec = promisify(execFile)

export async function stageVerifiedElectronHost(destination) {
  const artifact = await resolveElectronFork()
  await access(path.join(artifact.appPath, 'Contents/Info.plist'))
  await exec('ditto', [artifact.appPath, destination])
  await writeFile(
    path.join(destination, 'Contents/Resources/action-driver-electron-provenance.json'),
    `${JSON.stringify(artifact.provenance, null, 2)}\n`
  )
  return artifact
}
