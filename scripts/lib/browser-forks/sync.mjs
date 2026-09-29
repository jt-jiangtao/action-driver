import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { exists, git } from './inputs.mjs'
import { logPath, toolsEnvironment } from './prepare.mjs'
import { stageResult } from './pipeline.mjs'

export async function assertCleanCheckout(root, source) {
  if (await git(root, 'remote', 'get-url', 'origin') !== source.repo || await git(root, 'rev-parse', 'HEAD') !== source.commit) throw new Error(`SOURCE_MISMATCH: ${root}`)
  if (await git(root, 'status', '--porcelain')) throw new Error(`DIRTY_CHECKOUT: ${root}; commit or preserve your changes before sync`)
}
export async function ensureConfig(file, expected) {
  if (await exists(file)) {
    if (await readFile(file, 'utf8') !== expected) throw new Error(`CONFIG_CONFLICT: ${file}`)
  } else {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, expected, { flag: 'wx' })
  }
}
export async function runSync(context) {
  const workspace = path.join(context.root, 'thirdparty/build/electron-workspace')
  const chromium = path.join(workspace, 'src')
  const electron = path.join(chromium, 'electron')
  // All existing source conflicts must be found before fetching or installing.
  for (const source of Object.values(context.lock.sources)) {
    const checkout = path.join(context.root, source.path)
    if (await exists(path.join(checkout, '.git'))) await assertCleanCheckout(checkout, source)
  }
  if (await exists(electron)) await assertCleanCheckout(electron, context.lock.sources.electron)
  if (await exists(path.join(chromium, '.git'))) {
    if (await git(chromium, 'remote', 'get-url', 'origin') !== context.lock.chromium.repo) throw new Error('SOURCE_MISMATCH: Chromium origin')
    await git(chromium, 'merge-base', '--is-ancestor', context.lock.chromium.commit, 'HEAD')
    if (await git(chromium, 'status', '--porcelain', '--ignore-submodules=all')) throw new Error('DIRTY_CHECKOUT: Chromium')
  }
  const template = await readFile(path.join(context.root, 'config/browser-forks/gclient.tmpl'), 'utf8')
  await ensureConfig(path.join(workspace, '.gclient'), template.replaceAll('{{chromiumCommit}}', context.lock.chromium.commit))
  const env = toolsEnvironment(context)
  const command = (file, args, cwd, name) => context.run({ file, args, cwd, env, logPath: logPath(context, name) })
  await command('git', ['submodule', 'update', '--init', '--recursive', '--', ...Object.values(context.lock.sources).map(source => source.path)], context.root, 'submodules')
  for (const source of Object.values(context.lock.sources)) await assertCleanCheckout(path.join(context.root, source.path), source)
  await mkdir(chromium, { recursive: true })
  if (!await exists(path.join(chromium, '.git'))) {
    await command('git', ['init', '.'], chromium, 'chromium-init')
    await command('git', ['remote', 'add', 'origin', context.lock.chromium.repo], chromium, 'chromium-origin')
    await command('git', ['fetch', '--depth=1', 'origin', context.lock.chromium.commit], chromium, 'chromium-fetch')
    await command('git', ['checkout', '--detach', context.lock.chromium.commit], chromium, 'chromium-checkout')
  }
  if (!await exists(electron)) {
    await command('git', ['clone', '--no-checkout', context.lock.sources.electron.repo, electron], workspace, 'electron-clone')
    await command('git', ['checkout', '--detach', context.lock.sources.electron.commit], electron, 'electron-checkout')
  }
  await assertCleanCheckout(electron, context.lock.sources.electron)
  const sourceGit = await git(path.join(context.root, context.lock.sources.electron.path), 'rev-parse', '--absolute-git-dir')
  const buildGit = await git(electron, 'rev-parse', '--absolute-git-dir')
  if (sourceGit === buildGit) throw new Error('SHARED_GIT_METADATA: Electron')
  await command(path.join(context.root, 'thirdparty/tools/depot_tools/gclient'), ['sync', '--no-history'], workspace, 'gclient-sync')
  const node = path.join(context.root, `thirdparty/tools/node-v${context.lock.tools.node.version}-darwin-arm64/bin/node`)
  const playwright = path.join(context.root, context.lock.sources.playwright.path)
  await command(path.join(path.dirname(node), 'npm'), ['ci'], playwright, 'playwright-install')
  await command(node, ['.yarn/releases/yarn-4.12.0.cjs', 'install', '--immutable'], electron, 'electron-install')
  await assertCleanCheckout(electron, context.lock.sources.electron)
  const report = path.join(context.root, 'thirdparty/build/browser-forks/sources.json')
  await writeFile(report, JSON.stringify({ electronCommit: await git(electron, 'rev-parse', 'HEAD'), chromiumCommit: await git(chromium, 'rev-parse', 'HEAD'), chromiumTree: await git(chromium, 'rev-parse', 'HEAD^{tree}'), playwrightCommit: await git(playwright, 'rev-parse', 'HEAD') }, null, 2) + '\n')
  return stageResult(context, [report, path.join(workspace, '.gclient'), path.join(electron, 'yarn.lock'), path.join(playwright, 'package-lock.json')])
}
