import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveElectronFork, sha256 } from '../../../../scripts/lib/electron-fork.mjs'

const api = await import('../../../../scripts/lib/packaged-electron-host.mjs').catch(() => ({}))

test('packaged host copies the verified Fork and its provenance', async (t) => {
  assert.equal(typeof api.stageVerifiedElectronHost, 'function')
  const directory = await mkdtemp(path.join(tmpdir(), 'action-driver-host-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const destination = path.join(directory, 'Action-Driver.app')
  const artifact = await resolveElectronFork()
  await api.stageVerifiedElectronHost(destination)
  const provenance = JSON.parse(await readFile(
    path.join(destination, 'Contents/Resources/action-driver-electron-provenance.json'), 'utf8'
  ))
  assert.equal(provenance.sourceCommit, artifact.provenance.sourceCommit)
  assert.equal(provenance.executableSha256, artifact.provenance.executableSha256)
  assert.equal(
    await sha256(path.join(destination, 'Contents/MacOS/Electron')),
    artifact.provenance.executableSha256
  )
})
