import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
const api = await import('../../../../scripts/lib/electron-fork.mjs').catch(() => ({}))

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'fork test '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = path.join(root, 'thridparty/build/electron/Electron.app')
  await mkdir(path.join(app, 'Contents/MacOS'), { recursive: true })
  await mkdir(path.join(root, 'config'))
  await mkdir(path.join(root, 'apps/desktop'), { recursive: true })
  await writeFile(
    path.join(root, 'apps/desktop/package.json'),
    JSON.stringify({ devDependencies: { electron: '38.8.6' } })
  )
  const exe = path.join(app, 'Contents/MacOS/Electron')
  await writeFile(
    exe,
    '#!/bin/sh\nprintf \'{"electron":"38.8.6","chrome":"140.0.7339.249","arch":"arm64","platform":"darwin"}\'\n',
    { mode: 0o755 }
  )
  await writeFile(path.join(app, 'framework'), 'original')
  const m = {
    schemaVersion: 1,
    buildArgs: '# fixture args\n',
    buildArgsSha256: createHash('sha256').update('# fixture args\n').digest('hex'),
    chromiumBaseCommit: '51dd6cfc5c0bb8a297725ae9270ca43fb0fcc8e2',
    platform: 'darwin',
    arch: 'arm64',
    version: '38.8.6',
    chromiumVersion: '140.0.7339.249',
    repo: 'https://github.com/jt-jiangtao/electron.git',
    sourceCommit: 'fbc489c43be82f0fc331560ae678a39aeaea38c8',
    chromiumCommit: '31c3b2fb7d154bd181fdf73ec6e9a6c36e38312f',
    appPath: 'thridparty/build/electron/Electron.app',
    executableRelativePath: 'Contents/MacOS/Electron',
    executableSha256: await api.sha256(exe),
    appSha256: await api.sha256Tree(app)
  }
  const config = path.join(root, 'config/electron-fork.json')
  await writeFile(config, JSON.stringify(m))
  return { root, app, exe, m, config }
}
function options(root) {
  return { projectRoot: root, platform: 'darwin', arch: 'arm64' }
}
test('accepts recorded artifact independently of cwd and spaces', async (t) => {
  assert.equal(typeof api.resolveElectronFork, 'function')
  const f = await fixture(t)
  assert.equal(
    (await api.resolveElectronFork(options(f.root))).executablePath,
    await realpath(f.exe)
  )
})
for (const [name, change, message] of [
  ['missing bundle', async (f) => rm(f.app, { recursive: true }), /ARTIFACT_MISSING/],
  [
    'changed framework',
    async (f) => writeFile(path.join(f.app, 'framework'), 'changed'),
    /CHECKSUM_MISMATCH/
  ],
  [
    'wrong version',
    async (f) => {
      f.m.version = '39.0.0'
      await writeFile(f.config, JSON.stringify(f.m))
    },
    /VERSION_MISMATCH/
  ],
  [
    'wrong architecture',
    async (f) => {
      f.m.arch = 'x64'
      await writeFile(f.config, JSON.stringify(f.m))
    },
    /ARCH_MISMATCH/
  ],
  [
    'executable outside bundle',
    async (f) => {
      f.m.executableRelativePath = '../../outside'
      await writeFile(f.config, JSON.stringify(f.m))
    },
    /PATH_OUTSIDE/
  ],
  [
    'invalid provenance',
    async (f) => {
      f.m.sourceCommit = 'main'
      await writeFile(f.config, JSON.stringify(f.m))
    },
    /PROVENANCE_INVALID/
  ]
])
  test(`rejects ${name}`, async (t) => {
    assert.equal(typeof api.resolveElectronFork, 'function')
    const f = await fixture(t)
    await change(f)
    await assert.rejects(api.resolveElectronFork(options(f.root)), message)
  })

test('rejects a present checkout that does not contain the recorded build commit', async (t) => {
  const f = await fixture(t)
  const { execFileSync } = await import('node:child_process')
  const source = path.join(f.root, 'thridparty/electron')
  await mkdir(source, { recursive: true })
  execFileSync('git', ['init', '-q', source])
  execFileSync('git', ['-C', source, 'remote', 'add', 'origin', f.m.repo])
  await assert.rejects(api.resolveElectronFork(options(f.root)), /SOURCE_MISMATCH/)
})

test('rejects runtime version mismatch even with matching hashes', async (t) => {
  const f = await fixture(t)
  await writeFile(
    f.exe,
    '#!/bin/sh\nprintf \'{"electron":"39.0.0","chrome":"140.0.7339.249","arch":"arm64","platform":"darwin"}\'\n',
    { mode: 0o755 }
  )
  f.m.executableSha256 = await api.sha256(f.exe)
  f.m.appSha256 = await api.sha256Tree(f.app)
  await writeFile(f.config, JSON.stringify(f.m))
  await assert.rejects(api.resolveElectronFork(options(f.root)), /VERSION_MISMATCH: runtime/)
})

test('rejects bundle symlink escaping recorded runtime', async (t) => {
  const f = await fixture(t)
  const { symlink } = await import('node:fs/promises')
  await writeFile(path.join(f.root, 'outside'), 'external dependency')
  await symlink(path.join(f.root, 'outside'), path.join(f.app, 'outside'))
  await assert.rejects(api.resolveElectronFork(options(f.root)), /PATH_OUTSIDE/)
})

for (const field of ['buildArgs', 'buildArgsSha256', 'chromiumBaseCommit'])
  test(`rejects missing provenance ${field}`, async (t) => {
    const f = await fixture(t)
    delete f.m[field]
    await writeFile(f.config, JSON.stringify(f.m))
    await assert.rejects(api.resolveElectronFork(options(f.root)), /PROVENANCE_INVALID/)
  })
test('rejects inconsistent build args checksum', async (t) => {
  const f = await fixture(t)
  f.m.buildArgs = 'modified'
  await writeFile(f.config, JSON.stringify(f.m))
  await assert.rejects(api.resolveElectronFork(options(f.root)), /PROVENANCE_INVALID/)
})
