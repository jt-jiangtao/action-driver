import { stageVerifiedElectronHost } from './lib/packaged-electron-host.mjs'
import { existsSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

  await stageVerifiedElectronHost(app)
  rmSync(join(app, 'Contents', 'Resources', 'default_app.asar'), { force: true })
  run('ditto', [desktopDeployment, join(app, 'Contents', 'Resources', 'app')])
  run('ditto', [runtimeDeployment, join(app, 'Contents', 'Resources', 'agent-runtime')])
  const computerHelperSource = join(root, 'plugins', 'computer-use', 'native',
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
  run('ditto', [join(builtRuntimeDist, 'js-repl'), join(runtimeDist, 'js-repl')])
  if (!existsSync(join(runtimeDist, 'prompts', 'main.md'))) {
    throw new Error('PACKAGED_MAIN_PROMPT_MISSING')
  }
  // The JavaScript entry runs as its own Node process, so the packaged tree must carry the child
  // script and be able to answer one call with the bundled runtime.
  const jsEntry = join(runtimeDist, 'js-repl', 'repl-server.mjs')
  if (!existsSync(jsEntry)) throw new Error('PACKAGED_JS_ENTRY_MISSING')
  const jsProbe = spawnSync(
    join(runtimeDist, 'runtimes', `darwin-${process.arch}`, 'node', 'bin', 'node'),
    ['--experimental-vm-modules', '--no-warnings', jsEntry],
    { input: `${JSON.stringify({ id: 1, code: 'nodeRepl.write(String(1 + 1))' })}\n`, encoding: 'utf8' }
  )
  if (jsProbe.status !== 0 || !jsProbe.stdout.includes('"text":"2"')) {
    throw new Error(`PACKAGED_JS_ENTRY_FAILED: ${jsProbe.stdout}${jsProbe.stderr}`)
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
  for (const relativePath of ['plugin.json', 'dist/extension.js', 'dist/catalog.js', 'skills/computer-use/SKILL.md', 'SOURCE.md']) {
    if (!existsSync(join(runtimeDist, 'plugins', 'computer-use', relativePath))) throw new Error(`PACKAGED_COMPUTER_PLUGIN_MISSING: ${relativePath}`)
  }
  const skillOwners = { documents: 'documents', pdf: 'pdf', presentations: 'presentations', spreadsheets: 'spreadsheets', 'skill-creator': 'skills', imagegen: 'image-generation' }
  for (const [skill, owner] of Object.entries(skillOwners)) {
    if (!existsSync(join(runtimeDist, 'plugins', owner, 'skills', skill, 'SKILL.md'))) throw new Error(`PACKAGED_PLUGIN_SKILL_MISSING: ${skill}`)
    if (existsSync(join(runtimeDist, 'system-skills', skill, 'SKILL.md'))) throw new Error(`PACKAGED_DUPLICATE_SKILL: ${skill}`)
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
    if (!existsSync(join(runtimeDist, 'plugins', 'image-generation', 'skills', 'imagegen', relativePath))) {
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
    if (!existsSync(join(runtimeDist, 'plugins', 'skills', 'skills', 'skill-creator', relativePath))) {
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
