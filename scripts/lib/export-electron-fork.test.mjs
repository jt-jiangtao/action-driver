import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activateElectronArtifact } from './export-electron-fork.mjs'
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'export fork '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const old = path.join(root, 'thridparty/build/electron/Electron.app')
  const next = path.join(root, 'compiled/Electron.app')
  await mkdir(old, { recursive: true })
  await mkdir(next, { recursive: true })
  await mkdir(path.join(root, 'config'))
  await writeFile(path.join(old, 'framework'), 'old')
  await writeFile(path.join(next, 'framework'), 'new')
  await writeFile(path.join(root, 'config/electron-fork.json'), 'old-record')
  return { root, old, next }
}
test('candidate validation failure preserves the existing matched pair', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    activateElectronArtifact({
      root: f.root,
      bundlePath: f.next,
      record: { version: 'new' },
      validate: async () => {
        throw new Error('invalid-candidate')
      }
    }),
    /invalid-candidate/
  )
  assert.equal(await readFile(path.join(f.old, 'framework'), 'utf8'), 'old')
  assert.equal(await readFile(path.join(f.root, 'config/electron-fork.json'), 'utf8'), 'old-record')
})
test('post-activation verification failure rolls back both bundle and record', async (t) => {
  const f = await fixture(t)
  let calls = 0
  await assert.rejects(
    activateElectronArtifact({
      root: f.root,
      bundlePath: f.next,
      record: { version: 'new' },
      validate: async () => {
        if (++calls === 2) throw new Error('activation-failed')
      }
    }),
    /activation-failed/
  )
  assert.equal(await readFile(path.join(f.old, 'framework'), 'utf8'), 'old')
  assert.equal(await readFile(path.join(f.root, 'config/electron-fork.json'), 'utf8'), 'old-record')
})
test('successful export keeps a recoverable old pair and enables the new pair', async (t) => {
  const f = await fixture(t)
  const backup = await activateElectronArtifact({
    root: f.root,
    bundlePath: f.next,
    record: { version: 'new' },
    validate: async () => undefined
  })
  assert.equal(await readFile(path.join(f.old, 'framework'), 'utf8'), 'new')
  assert.equal(
    JSON.parse(await readFile(path.join(f.root, 'config/electron-fork.json'), 'utf8')).version,
    'new'
  )
  assert.equal(await readFile(path.join(backup, 'Electron.app/framework'), 'utf8'), 'old')
  assert.equal(await readFile(path.join(backup, 'electron-fork.json'), 'utf8'), 'old-record')
})
test('concurrent activation cannot replace another active matched pair', async (t) => {
  const f = await fixture(t)
  let entered, release
  const ready = new Promise((resolve) => {
    entered = resolve
  })
  const hold = new Promise((resolve) => {
    release = resolve
  })
  let calls = 0
  const first = activateElectronArtifact({
    root: f.root,
    bundlePath: f.next,
    record: { version: 'new' },
    validate: async () => {
      if (++calls === 1) {
        entered()
        await hold
      }
    }
  })
  await ready
  try {
    await assert.rejects(
      activateElectronArtifact({
        root: f.root,
        bundlePath: f.next,
        record: { version: 'new' },
        validate: async () => undefined
      }),
      /EXPORT_ACTIVE/
    )
  } finally {
    release()
    await first
  }
})
