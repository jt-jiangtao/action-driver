import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ensureConfig, assertCleanCheckout } from './sync.mjs'
import { logPath, toolsEnvironment } from './prepare.mjs'
import { stageResult } from './pipeline.mjs'

export function ninjaCommand(context) {
  const src = path.join(context.root, 'thridparty/build/electron-workspace/src')
  return {
    file: '/bin/bash',
    // The shell program is constant; all user/path values are positional argv.
    args: ['-c', 'ulimit -n "$1" && exec "$2" -C "$3" -j "$4" electron', 'browser-forks', String(context.lock.build.fileLimit), path.join(src, 'third_party/ninja/ninja'), context.lock.build.output, String(context.jobs)],
    cwd: src, env: toolsEnvironment(context), logPath: logPath(context, 'electron-build')
  }
}
export async function runBuild(context) {
  const src = path.join(context.root, 'thridparty/build/electron-workspace/src')
  const electron = path.join(src, 'electron')
  const playwright = path.join(context.root, context.lock.sources.playwright.path)
  await assertCleanCheckout(electron, context.lock.sources.electron)
  await assertCleanCheckout(playwright, context.lock.sources.playwright)
  const environment = JSON.parse(await readFile(path.join(context.root, 'thridparty/build/browser-forks/environment.json'), 'utf8'))
  const template = await readFile(path.join(context.root, 'config/browser-forks/args.gn.tmpl'), 'utf8')
  const argsPath = path.join(src, context.lock.build.output, 'args.gn')
  await ensureConfig(argsPath, template.replaceAll('{{sdkPath}}', JSON.stringify(environment.sdkPath)))
  const env = toolsEnvironment(context)
  await context.run({ file: path.join(src, 'buildtools/mac/gn'), args: ['gen', context.lock.build.output], cwd: src, env, logPath: logPath(context, 'gn-gen') })
  await context.run(ninjaCommand(context))
  await context.run({ file: path.join(context.root, `thridparty/tools/node-v${context.lock.tools.node.version}-darwin-arm64/bin/npm`), args: ['run', 'build'], cwd: playwright, env, logPath: logPath(context, 'playwright-build') })
  return stageResult(context, [argsPath, path.join(src, context.lock.build.output, 'Electron.app'), path.join(playwright, 'packages/playwright-core/lib')])
}
