import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, readlink, realpath, access } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const exec = promisify(execFile)
const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const inside = (root, file) => {
  const relative = path.relative(root, file)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
const fail = (code, detail) => {
  throw new Error(`${code}: ${detail}. Prepare the recorded Fork artifact; see README.md.`)
}
export async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
export async function sha256Tree(root) {
  const entries = []
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name,
        file = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(file, name + '/')
      else if (entry.isFile()) entries.push([name, await sha256(file)])
      else if (entry.isSymbolicLink()) {
        if (!inside(root, await realpath(file))) fail('PATH_OUTSIDE', file)
        entries.push([name, 'symlink:' + (await readlink(file))])
      } else fail('ARTIFACT_INVALID', file)
    }
  }
  await visit(root)
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}
async function verifyCheckout(root, relative, repo, commit) {
  const source = path.join(root, relative)
  try {
    await access(path.join(source, '.git'))
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  try {
    const { stdout } = await exec('git', ['-C', source, 'remote', 'get-url', 'origin'])
    if (stdout.trim().replace(/\.git$/, '') !== repo.replace(/\.git$/, ''))
      fail('SOURCE_MISMATCH', source)
    await exec('git', ['-C', source, 'merge-base', '--is-ancestor', commit, 'HEAD'])
  } catch {
    fail('SOURCE_MISMATCH', source)
  }
}
export async function resolveElectronFork(options = {}) {
  const root = options.projectRoot ?? projectRoot
  try {
    const m = JSON.parse(await readFile(path.join(root, 'config/electron-fork.json'), 'utf8'))
    if (
      m.schemaVersion !== 1 ||
      m.repo !== 'https://github.com/jt-jiangtao/electron.git' ||
      !/^[a-f0-9]{40}$/.test(m.sourceCommit) ||
      !/^[a-f0-9]{40}$/.test(m.chromiumCommit) ||
      !/^[a-f0-9]{40}$/.test(m.chromiumBaseCommit) ||
      typeof m.buildArgs !== 'string' ||
      !/^[a-f0-9]{64}$/.test(m.buildArgsSha256) ||
      createHash('sha256').update(m.buildArgs).digest('hex') !== m.buildArgsSha256
    )
      fail('PROVENANCE_INVALID', 'source record')
    if (m.platform !== (options.platform ?? process.platform)) fail('PLATFORM_MISMATCH', m.platform)
    if (m.arch !== (options.arch ?? process.arch)) fail('ARCH_MISMATCH', m.arch)
    const pkg = JSON.parse(await readFile(path.join(root, 'apps/desktop/package.json'), 'utf8'))
    if (m.version !== pkg.devDependencies.electron) fail('VERSION_MISMATCH', m.version)
    await verifyCheckout(root, 'thirdparty/electron', m.repo, m.sourceCommit)
    await verifyCheckout(
      root,
      'thirdparty/build/electron-workspace/src',
      'https://github.com/chromium/chromium.git',
      m.chromiumCommit
    )
    await verifyCheckout(
      root,
      'thirdparty/build/electron-workspace/src',
      'https://github.com/chromium/chromium.git',
      m.chromiumBaseCommit
    )
    const appPath = path.resolve(root, m.appPath)
    const executablePath = path.resolve(appPath, m.executableRelativePath)
    if (!inside(root, appPath) || !inside(appPath, executablePath))
      fail('PATH_OUTSIDE', executablePath)
    const realApp = await realpath(appPath),
      realExe = await realpath(executablePath)
    if (!inside(await realpath(root), realApp) || !inside(realApp, realExe))
      fail('PATH_OUTSIDE', realExe)
    if (
      (await sha256(realExe)) !== m.executableSha256 ||
      (await sha256Tree(realApp)) !== m.appSha256
    )
      fail('CHECKSUM_MISMATCH', appPath)
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    delete env.NODE_OPTIONS
    const { stdout } = await exec(
      realExe,
      [
        '-p',
        'JSON.stringify({electron:process.versions.electron,chrome:process.versions.chrome,arch:process.arch,platform:process.platform})'
      ],
      { env, timeout: 15000 }
    )
    const actual = JSON.parse(stdout)
    if (actual.electron !== m.version || actual.chrome !== m.chromiumVersion)
      fail('VERSION_MISMATCH', 'runtime')
    if (actual.arch !== m.arch || actual.platform !== m.platform) fail('ARCH_MISMATCH', 'runtime')
    return { executablePath: realExe, appPath: realApp, provenance: m }
  } catch (error) {
    if (error.code === 'ENOENT') fail('ARTIFACT_MISSING', error.path)
    throw error
  }
}
