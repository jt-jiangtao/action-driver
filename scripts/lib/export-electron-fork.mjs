import { cp, mkdir, mkdtemp, readFile, writeFile, rename, rm, open, access } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { sha256, sha256Tree, resolveElectronFork } from './electron-fork.mjs'
import { createHash } from 'node:crypto'
const exec = promisify(execFile)
const digest = (value) => createHash('sha256').update(value).digest('hex')
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args])).stdout.trim()
async function exists(file) {
  try {
    await access(file)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

export async function activateElectronArtifact({ root, bundlePath, record, validate }) {
  const parent = path.join(root, 'thirdparty/build/electron')
  await mkdir(parent, { recursive: true })
  const lockPath = path.join(parent, '.export.lock')
  let handle
  try {
    handle = await open(lockPath, 'wx')
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('EXPORT_ACTIVE: another export is running')
    throw error
  }
  try {
    await handle.writeFile(String(process.pid))
    return await activateUnlocked({ root, bundlePath, record, validate, parent })
  } finally {
    await handle.close()
    await rm(lockPath)
  }
}

async function activateUnlocked({ root, bundlePath, record, validate, parent }) {
  await mkdir(path.join(root, 'config'), { recursive: true })
  const staging = await mkdtemp(path.join(parent, '.export-'))
  const stagedBundle = path.join(staging, 'Electron.app')
  const finalBundle = path.join(parent, 'Electron.app')
  const config = path.join(root, 'config/electron-fork.json')
  const stagedConfig = path.join(root, 'config', `.electron-fork-${path.basename(staging)}.json`)
  const backup = await mkdtemp(path.join(parent, 'backup-'))
  let movedOld = false,
    activatedBundle = false,
    activatedRecord = false
  const oldRecord = (await exists(config)) ? await readFile(config) : null
  try {
    await cp(bundlePath, stagedBundle, { recursive: true, verbatimSymlinks: true })
    await validate(stagedBundle, record)
    await writeFile(stagedConfig, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
    if (oldRecord) await writeFile(path.join(backup, 'electron-fork.json'), oldRecord)
    if (await exists(finalBundle)) {
      await rename(finalBundle, path.join(backup, 'Electron.app'))
      movedOld = true
    }
    await rename(stagedBundle, finalBundle)
    activatedBundle = true
    await rename(stagedConfig, config)
    activatedRecord = true
    await validate(finalBundle, record)
    return backup
  } catch (error) {
    if (activatedBundle) await rename(finalBundle, stagedBundle)
    if (movedOld) await rename(path.join(backup, 'Electron.app'), finalBundle)
    if (activatedRecord) {
      if (oldRecord) {
        await writeFile(stagedConfig, oldRecord)
        await rename(stagedConfig, config)
      } else await rm(config)
    }
    throw error
  } finally {
    await rm(stagedConfig, { force: true })
    await rm(staging, { recursive: true, force: true })
  }
}

export async function exportElectronFork(root) {
  const source = path.join(root, 'thirdparty/electron')
  const src = path.join(root, 'thirdparty/build/electron-workspace/src')
  const buildSource = path.join(src, 'electron')
  const out = path.join(src, 'out/Action-Driver')
  const lock = JSON.parse(await readFile(path.join(root, 'config/browser-forks.lock.json'), 'utf8'))
  for (const checkout of [source, buildSource]) {
    if (await git(checkout, 'status', '--porcelain')) throw new Error(`SOURCE_DIRTY: ${checkout}`)
    if (
      (await git(checkout, 'rev-parse', 'HEAD')) !== lock.sources.electron.commit ||
      (await git(checkout, 'remote', 'get-url', 'origin')) !== lock.sources.electron.repo
    )
      throw new Error(`SOURCE_MISMATCH: ${checkout}`)
  }
  await git(src, 'merge-base', '--is-ancestor', lock.chromium.commit, 'HEAD')
  if (await git(src, 'status', '--porcelain', '--ignore-submodules=all'))
    throw new Error('SOURCE_DIRTY: Chromium')
  const env = {
    ...process.env,
    PATH: [
      path.join(src, 'buildtools/mac'),
      path.join(src, 'third_party/ninja'),
      path.join(root, `thirdparty/tools/node-v${lock.tools.node.version}-darwin-arm64/bin`),
      process.env.PATH
    ].join(path.delimiter)
  }
  delete env.ELECTRON_RUN_AS_NODE
  const dryRun = await exec(
    path.join(src, 'third_party/ninja/ninja'),
    ['-n', '-C', out, 'electron'],
    { cwd: src, env, maxBuffer: 8e6 }
  )
  if (!dryRun.stdout.includes('no work to do.'))
    throw new Error('BUILD_INCOMPLETE: finish ninja electron before exporting')
  const buildArgs = await readFile(path.join(out, 'args.gn'), 'utf8')
  if (!/^action_driver\s*=\s*true\s*$/m.test(buildArgs))
    throw new Error('WATERMARK_CONFIG_MISSING: action_driver=true')
  const official = await exec(
    path.join(src, 'buildtools/mac/gn'),
    ['args', out, '--list=is_official_build', '--short'],
    { cwd: src, env }
  )
  const development = /is_official_build\s*=\s*false/.test(official.stdout)
  const bundlePath = path.join(out, 'Electron.app')
  const executable = path.join(bundlePath, 'Contents/MacOS/Electron')
  const nodeEnv = { ...env, ELECTRON_RUN_AS_NODE: '1' }
  delete nodeEnv.NODE_OPTIONS
  const actual = JSON.parse(
    (
      await exec(
        executable,
        [
          '-p',
          'JSON.stringify({electron:process.versions.electron,chrome:process.versions.chrome,arch:process.arch,platform:process.platform})'
        ],
        { env: nodeEnv, timeout: 15000 }
      )
    ).stdout
  )
  if (
    actual.electron !== lock.sources.electron.version ||
    actual.chrome !== lock.chromium.version ||
    actual.arch !== 'arm64' ||
    actual.platform !== 'darwin'
  )
    throw new Error('RUNTIME_MISMATCH: compiled Electron')
  const record = {
    schemaVersion: 1,
    platform: actual.platform,
    arch: actual.arch,
    version: actual.electron,
    chromiumVersion: actual.chrome,
    repo: lock.sources.electron.repo,
    sourceCommit: lock.sources.electron.commit,
    sourceTree: await git(source, 'rev-parse', 'HEAD^{tree}'),
    chromiumCommit: await git(src, 'rev-parse', 'HEAD'),
    chromiumTree: await git(src, 'rev-parse', 'HEAD^{tree}'),
    chromiumBaseCommit: lock.chromium.commit,
    patchQueueSha256: await sha256Tree(path.join(source, 'patches')),
    appPath: 'thirdparty/build/electron/Electron.app',
    executableRelativePath: 'Contents/MacOS/Electron',
    executableSha256: await sha256(executable),
    appSha256: await sha256Tree(bundlePath),
    buildArgs,
    buildArgsSha256: digest(buildArgs),
    watermark: {
      enabled: true,
      developmentDefault: development,
      text: 'action-driver-dev',
      opacity: 0.05
    }
  }
  const backup = await activateElectronArtifact({
    root,
    bundlePath,
    record,
    validate: async (candidate, metadata) => {
      if (
        (await sha256(path.join(candidate, metadata.executableRelativePath))) !==
          metadata.executableSha256 ||
        (await sha256Tree(candidate)) !== metadata.appSha256
      )
        throw new Error('CHECKSUM_MISMATCH: export')
      if (candidate === path.join(root, metadata.appPath))
        await resolveElectronFork({ projectRoot: root })
    }
  })
  return { record, backup }
}
