import { existsSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') throw new Error('macOS packaged smoke requires macOS')

const root = resolve(import.meta.dirname, '..')
const temporary = mkdtempSync(join(tmpdir(), 'actiondriver-packaged-smoke-'))
const desktopDeployment = join(temporary, 'desktop')
const runtimeDeployment = join(temporary, 'runtime')
const app = join(temporary, 'ActionDriver.app')

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}

try {
  run('corepack', ['pnpm', 'build:native:electron'])
  run('corepack', ['pnpm', 'build:native:computer-use'])
  run('corepack', ['pnpm', '--filter', '@actiondriver/agent-runtime', 'build'])
  run('corepack', ['pnpm', '--filter', '@actiondriver/desktop', 'build'])
  run('corepack', [
    'pnpm',
    '--filter',
    '@actiondriver/desktop',
    'deploy',
    '--prod',
    desktopDeployment
  ])
  run('corepack', [
    'pnpm',
    '--filter',
    '@actiondriver/agent-runtime',
    'deploy',
    '--prod',
    runtimeDeployment
  ])

  const require = createRequire(import.meta.url)
  const electronExecutable = require('electron')
  const electronApp = dirname(dirname(dirname(electronExecutable)))
  if (!existsSync(join(electronApp, 'Contents', 'Info.plist'))) {
    throw new Error('Electron macOS application bundle was not found')
  }
  run('ditto', [electronApp, app])
  rmSync(join(app, 'Contents', 'Resources', 'default_app.asar'), { force: true })
  run('ditto', [desktopDeployment, join(app, 'Contents', 'Resources', 'app')])
  run('ditto', [runtimeDeployment, join(app, 'Contents', 'Resources', 'agent-runtime')])
  const computerHelperSource = join(root, 'apps', 'native-computer-use-helper',
    'dist', process.arch, 'ActionDriver Computer Use.app')
  const computerHelperBundle = join(app, 'Contents', 'Helpers', 'ActionDriver Computer Use.app')
  run('ditto', [computerHelperSource, computerHelperBundle])
  const computerHelper = join(computerHelperBundle, 'Contents', 'MacOS', 'actiondriver-computer-use')
  if (!(statSync(computerHelper).mode & 0o111)) {
    throw new Error('PACKAGED_COMPUTER_HELPER_NOT_EXECUTABLE')
  }
  run('/usr/bin/file', [computerHelper])
  run('codesign', ['--verify', '--strict', '--verbose=2', computerHelperBundle])
  const runtimeDist = join(app, 'Contents', 'Resources', 'agent-runtime', 'dist')
  const builtRuntimeDist = join(root, 'apps', 'agent-runtime', 'dist')
  run('ditto', [join(builtRuntimeDist, 'runtimes'), join(runtimeDist, 'runtimes')])
  run('ditto', [join(builtRuntimeDist, 'bin'), join(runtimeDist, 'bin')])
  run('ditto', [join(builtRuntimeDist, 'system-skills'), join(runtimeDist, 'system-skills')])
  run('ditto', [join(builtRuntimeDist, 'prompts'), join(runtimeDist, 'prompts')])
  if (!existsSync(join(runtimeDist, 'prompts', 'main.md'))) {
    throw new Error('PACKAGED_MAIN_PROMPT_MISSING')
  }
  // The verifier stages the local dependency tree the same way it stages the
  // bundled runtimes; release packaging keeps its own decision on this tree.
  if (!existsSync(join(builtRuntimeDist, 'dependencies'))) {
    throw new Error(
      'PACKAGED_DEPENDENCIES_MISSING: run pnpm --filter @actiondriver/agent-runtime build:office-local first'
    )
  }
  run('ditto', [join(builtRuntimeDist, 'dependencies'), join(runtimeDist, 'dependencies')])
  for (const relativePath of [
    'node/bin/node',
    'python/bin/python3',
    'bin/override/soffice',
    'bin/override/pdftoppm'
  ]) {
    const file = join(runtimeDist, 'dependencies', relativePath)
    if (!existsSync(file) || !(statSync(file).mode & 0o111)) {
      throw new Error(`PACKAGED_DEPENDENCY_MISSING: ${relativePath}`)
    }
  }
  for (const skill of [
    'computer-use',
    'documents',
    'imagegen',
    'pdf',
    'presentations',
    'skill-creator',
    'spreadsheets'
  ]) {
    if (!existsSync(join(runtimeDist, 'system-skills', skill, 'SKILL.md'))) {
      throw new Error(`PACKAGED_SYSTEM_SKILL_MISSING: ${skill}`)
    }
  }
  for (const relativePath of [
    'LICENSE.txt',
    'agents/openai.yaml',
    'assets/imagegen-small.svg',
    'assets/imagegen.png',
    'references/cli.md',
    'references/codex-network.md',
    'references/codex-original-skill.md',
    'references/image-api.md',
    'references/prompting.md',
    'references/sample-prompts.md',
    'scripts/image_gen.py',
    'scripts/remove_chroma_key.py'
  ]) {
    if (!existsSync(join(runtimeDist, 'system-skills', 'imagegen', relativePath))) {
      throw new Error(`PACKAGED_IMAGEGEN_RESOURCE_MISSING: ${relativePath}`)
    }
  }
  for (const relativePath of [
    'scripts/init_skill.py',
    'scripts/quick_validate.py',
    'scripts/generate_openai_yaml.py',
    'references/openai_yaml.md',
    'references/codex-skill-creator.md',
    'agents/openai.yaml',
    'assets/skill-creator-small.svg',
    'assets/skill-creator.png',
    'license.txt'
  ]) {
    if (!existsSync(join(runtimeDist, 'system-skills', 'skill-creator', relativePath))) {
      throw new Error(`PACKAGED_SKILL_CREATOR_RESOURCE_MISSING: ${relativePath}`)
    }
  }
  const arch = process.arch
  for (const binary of [
    join(runtimeDist, 'runtimes', `darwin-${arch}`, 'python', 'bin', 'python3'),
    join(runtimeDist, 'runtimes', `darwin-${arch}`, 'node', 'bin', 'node'),
    join(runtimeDist, 'bin', 'rg')
  ]) {
    if (!existsSync(binary) || !(statSync(binary).mode & 0o111)) {
      throw new Error(`PACKAGED_RUNTIME_MISSING: ${binary}`)
    }
    run('/usr/bin/file', [binary])
  }
  renameSync(
    join(app, 'Contents', 'MacOS', 'Electron'),
    join(app, 'Contents', 'MacOS', 'ActionDriver')
  )
  run('/usr/libexec/PlistBuddy', [
    '-c',
    'Set :CFBundleExecutable ActionDriver',
    join(app, 'Contents', 'Info.plist')
  ])
  run(
    'corepack',
    ['pnpm', 'exec', 'playwright', 'test', 'apps/desktop/e2e/packaged-runtime.spec.ts'],
    { ...process.env, ACTIONDRIVER_PACKAGED_APP: app }
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
