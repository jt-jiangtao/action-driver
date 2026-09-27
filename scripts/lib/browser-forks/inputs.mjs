import { readFile, access } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import path from 'node:path'
const execute = promisify(execFile)
export const digest = value => createHash('sha256').update(value).digest('hex')
export const git = async (cwd, ...args) => (await execute('git', ['-C', cwd, ...args])).stdout.trim()
export async function exists(file) {
  try { await access(file); return true } catch(error) { if(error.code === 'ENOENT') return false; throw error }
}
const invalid = detail => { throw new Error(`INPUT_INVALID: ${detail}`) }
const version = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value)
const commit = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
export function validateLock(lock) {
  if (lock.schemaVersion !== 1 || lock.platform !== 'darwin' || lock.arch !== 'arm64') invalid('platform')
  for (const name of ['playwright','electron']) {
    const source = lock.sources?.[name]
    if (source?.path !== `thridparty/${name}` || source.repo !== `https://github.com/jt-jiangtao/${name}.git` || !commit(source.commit) || !version(source.version)) invalid(name)
  }
  if(lock.chromium?.repo !== 'https://github.com/chromium/chromium.git' || !commit(lock.chromium.commit) || !/^\d+\.\d+\.\d+\.\d+$/.test(lock.chromium.version)) invalid('Chromium')
  const tools=lock.tools
  if(!version(tools?.node?.version) || !/^[a-f0-9]{64}$/.test(tools.node.sha256 ?? '') || tools.node.url !== `https://nodejs.org/dist/v${tools.node.version}/node-v${tools.node.version}-darwin-arm64.tar.gz` || !commit(tools.depotTools?.commit) || tools.depotTools.repo !== 'https://chromium.googlesource.com/chromium/tools/depot_tools.git') invalid('tools')
  for(const tool of ['pnpm','yarn','nodeGyp']) if(!version(tools[tool])) invalid(tool)
  if(lock.system?.sdkVersion !== '26.5' || lock.system.metalRequired !== true || lock.build?.output !== 'out/ActionDriver' || lock.build.fileLimit !== 65536 || !Number.isSafeInteger(lock.build.jobs) || lock.build.jobs < 1) invalid('build')
}
export async function loadBuildInputs(root) {
  const text = await readFile(path.join(root,'config/browser-forks.lock.json'),'utf8')
  const lock = JSON.parse(text)
  validateLock(lock)
  for(const [name, source] of Object.entries(lock.sources)) {
    const mapping = await git(root,'config','-f','.gitmodules',`submodule.${name}.path`)
    const url = await git(root,'config','-f','.gitmodules',`submodule.${name}.url`)
    if(mapping !== source.path || url !== source.repo) throw new Error(`SUBMODULE_MISMATCH: ${name}`)
    const entry = await git(root,'ls-files','--stage','--',source.path)
    if(entry !== `160000 ${source.commit} 0\t${source.path}`) throw new Error(`GITLINK_MISMATCH: ${name}`)
    const sourceRoot=path.join(root,source.path)
    if(await exists(path.join(sourceRoot,'.git'))) {
      if(await git(sourceRoot,'rev-parse','HEAD') !== source.commit || await git(sourceRoot,'remote','get-url','origin') !== source.repo) throw new Error(`SOURCE_MISMATCH: ${name}`)
      if(name === 'electron') {
        const deps=await readFile(path.join(sourceRoot,'DEPS'),'utf8')
        if(!deps.includes(`'${lock.chromium.version}'`)) throw new Error('DEPS_MISMATCH: Chromium')
      }
    }
  }
  const templates = await Promise.all(['args.gn.tmpl','gclient.tmpl','package-boundary.json'].map(name=>readFile(path.join(root,'config/browser-forks',name),'utf8')))
  return {lock, digest:digest(JSON.stringify({lock,templates}))}
}
