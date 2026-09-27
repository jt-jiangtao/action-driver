import { mkdir, readFile, writeFile, mkdtemp, rename, rm, statfs } from 'node:fs/promises'
import path from 'node:path'
import { exists, git, digest } from './inputs.mjs'
import { stageResult } from './pipeline.mjs'

export function validatePrerequisites(report) {
  if (report.platform !== 'darwin' || report.arch !== 'arm64') throw new Error('PREREQUISITE_MISSING: requires macOS arm64')
  if (report.sdkVersion !== '26.5') throw new Error('PREREQUISITE_MISSING: install/select macOS SDK 26.5 using Xcode; xcode-select -p')
  if (!report.metalAvailable) throw new Error('PREREQUISITE_MISSING: xcodebuild -downloadComponent MetalToolchain (manual system setup)')
  if (report.freeBytes < 100e9) throw new Error('PREREQUISITE_MISSING: at least 100 GB free for a fresh Chromium build')
}
export async function ensureBoundary(file) {
  if (await exists(file)) {
    const value = JSON.parse(await readFile(file, 'utf8'))
    if (value.private !== true || Object.keys(value).length !== 1) throw new Error(`CONFIG_CONFLICT: ${file}`)
  } else {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, '{"private":true}\n', { flag: 'wx' })
  }
}
export const logPath = (context, name) => path.join(context.root, 'thridparty/logs/browser-forks', name + '.log')
export async function capture(context, file, args, name, cwd = context.root) {
  const output = logPath(context, name)
  // Capture commands get distinct logs so an old run cannot contaminate the answer.
  await rm(output, { force: true })
  await context.run({ file, args, cwd, logPath: output })
  return (await readFile(output, 'utf8')).split('\n').slice(1).join('\n').trim()
}
export function toolsEnvironment(context) {
  const tools = path.join(context.root, 'thridparty/tools')
  return { ...process.env,
    PATH: [path.join(tools, `node-v${context.lock.tools.node.version}-darwin-arm64/bin`), path.join(tools, 'depot_tools'), process.env.PATH].join(path.delimiter),
    DEPOT_TOOLS_UPDATE: '0', COREPACK_HOME: path.join(tools, 'corepack'),
    npm_config_cache: path.join(tools, 'npm-cache') }
}
export async function installNode(context, options = {}) {
  const { version, sha256, url } = context.lock.tools.node
  const tools = path.join(context.root, 'thridparty/tools')
  await mkdir(tools, { recursive: true })
  const temporary = await mkdtemp(path.join(tools, '.node-install-'))
  try {
    const archive = options.archive ?? path.join(temporary, 'node.tar.gz')
    if (!options.archive) await context.run({ file: '/usr/bin/curl', args: ['--fail', '--location', '--retry', '3', '--output', archive, url], cwd: context.root, logPath: logPath(context, 'node-download') })
    if (digest(await readFile(archive)) !== sha256) throw new Error('CHECKSUM_MISMATCH: Node archive')
    if (options.extract) await options.extract(archive, temporary)
    else await context.run({ file: '/usr/bin/tar', args: ['-xzf', archive, '-C', temporary], cwd: context.root, logPath: logPath(context, 'node-extract') })
    const name = `node-v${version}-darwin-arm64`
    const staged = path.join(temporary, name), target = path.join(tools, name)
    const stagedNode = path.join(staged, 'bin/node')
    if (!await exists(stagedNode)) throw new Error('TOOL_INVALID: Node executable missing')
    if (await exists(target)) {
      if (digest(await readFile(path.join(target, 'bin/node'))) !== digest(await readFile(stagedNode))) throw new Error(`TOOL_CONFLICT: ${target}`)
    } else await rename(staged, target)
    return path.join(target, 'bin/node')
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
export async function runPrepare(context) {
  // System checks precede any tool installation or configuration changes.
  if (process.platform !== 'darwin' || process.arch !== 'arm64') validatePrerequisites({ platform: process.platform, arch: process.arch })
  const developer = await capture(context, '/usr/bin/xcode-select', ['-p'], 'developer-path')
  await capture(context, '/usr/bin/git', ['--version'], 'git-version')
  await capture(context, '/usr/bin/python3', ['--version'], 'python-version')
  const sdkCandidates = [path.join(developer, 'SDKs/MacOSX26.5.sdk'), path.join(developer, 'Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.5.sdk'), '/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk']
  let sdkPath
  for (const candidate of sdkCandidates) if (await exists(candidate)) { sdkPath = candidate; break }
  const settings = sdkPath ? JSON.parse(await readFile(path.join(sdkPath, 'SDKSettings.json'), 'utf8')) : {}
  let metalPath
  try { metalPath = await capture(context, '/usr/bin/xcrun', ['--find', 'metal'], 'metal-path') } catch { /* Report the explicit preparation step below. */ }
  const disk = await statfs(context.root)
  validatePrerequisites({ platform: process.platform, arch: process.arch, sdkVersion: settings.Version, metalAvailable: Boolean(metalPath), freeBytes: disk.bavail * disk.bsize })
  const metalVersion = await capture(context, metalPath, ['--version'], 'metal-version')
  await ensureBoundary(path.join(context.root, 'thridparty/package.json'))
  const node = await installNode(context)
  const nodeVersion = await capture(context, node, ['--version'], 'node-version')
  if (nodeVersion !== `v${context.lock.tools.node.version}`) throw new Error('TOOL_INVALID: Node version')
  const depot = path.join(context.root, 'thridparty/tools/depot_tools')
  if (await exists(depot)) {
    if (await git(depot, 'remote', 'get-url', 'origin') !== context.lock.tools.depotTools.repo || await git(depot, 'rev-parse', 'HEAD') !== context.lock.tools.depotTools.commit || await git(depot, 'status', '--porcelain', '--untracked-files=no')) throw new Error(`TOOL_CONFLICT: ${depot}`)
  } else {
    const temporary = await mkdtemp(path.join(path.dirname(depot), '.depot-install-'))
    try {
      const clone = path.join(temporary, 'checkout')
      await context.run({ file: 'git', args: ['clone', '--no-checkout', context.lock.tools.depotTools.repo, clone], cwd: context.root, logPath: logPath(context, 'depot-clone') })
      await context.run({ file: 'git', args: ['checkout', '--detach', context.lock.tools.depotTools.commit], cwd: clone, logPath: logPath(context, 'depot-checkout') })
      await rename(clone, depot)
    } finally { await rm(temporary, { recursive: true, force: true }) }
  }
  const report = path.join(context.root, 'thridparty/build/browser-forks/environment.json')
  await mkdir(path.dirname(report), { recursive: true })
  await writeFile(report, JSON.stringify({ sdkPath, sdkVersion: settings.Version, developer, metalPath, metalVersion, nodeVersion, depotCommit: context.lock.tools.depotTools.commit }, null, 2) + '\n')
  return stageResult(context, [report, node, path.join(depot, '.git/HEAD'), path.join(context.root, 'thridparty/package.json')])
}
