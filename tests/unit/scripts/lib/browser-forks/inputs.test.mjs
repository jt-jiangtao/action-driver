import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadBuildInputs } from '../../../../../scripts/lib/browser-forks/inputs.mjs'
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], {encoding:'utf8'}).trim()
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'fork inputs space '))
  t.after(() => rm(root, {recursive:true,force:true}))
  git(root,'init','-q')
  await mkdir(path.join(root,'config/browser-forks'),{recursive:true})
  for(const name of ['args.gn.tmpl','gclient.tmpl','package-boundary.json']) await writeFile(path.join(root,'config/browser-forks',name),await readFile(new URL('../../../../../config/browser-forks/'+name,import.meta.url)))
  const lock = JSON.parse(await readFile(new URL('../../../../../config/browser-forks.lock.json', import.meta.url),'utf8'))
  for(const [name,source] of Object.entries(lock.sources)) {
    const dir = path.join(root,source.path)
    await mkdir(dir,{recursive:true}); git(dir,'init','-q')
    await writeFile(path.join(dir,'fixture'),'source')
    git(dir,'add','.');git(dir,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','source')
    source.commit=git(dir,'rev-parse','HEAD')
    git(dir,'remote','add','origin',source.repo)
    git(root,'update-index','--add','--cacheinfo',`160000,${source.commit},${source.path}`)
    git(root,'config','-f','.gitmodules',`submodule.${name}.path`,source.path)
    git(root,'config','-f','.gitmodules',`submodule.${name}.url`,source.repo)
  }
  await writeFile(path.join(root,'thirdparty/electron/DEPS'),`vars = { 'chromium_version': '${lock.chromium.version}' }`)
  await writeFile(path.join(root,'config/browser-forks.lock.json'),JSON.stringify(lock))
  return {root,lock,save:()=>writeFile(path.join(root,'config/browser-forks.lock.json'),JSON.stringify(lock))}
}
test('accepts exact gitlinks and returns stable input digest', async t => {
 const f=await fixture(t);const a=await loadBuildInputs(f.root);const b=await loadBuildInputs(f.root)
 assert.equal(a.digest,b.digest);assert.equal(a.lock.tools.node.version,'22.23.3')
})
test('rejects gitlink drift',async t=>{const f=await fixture(t);f.lock.sources.electron.commit='a'.repeat(40);await f.save();await assert.rejects(loadBuildInputs(f.root),/GITLINK_MISMATCH/)})
test('rejects missing tool version',async t=>{const f=await fixture(t);delete f.lock.tools.node.version;await f.save();await assert.rejects(loadBuildInputs(f.root),/INPUT_INVALID/)})
test('rejects unexpected Chromium baseline',async t=>{const f=await fixture(t);f.lock.chromium.commit='main';await f.save();await assert.rejects(loadBuildInputs(f.root),/INPUT_INVALID/)})
test('rejects Chromium DEPS version drift',async t=>{const f=await fixture(t);f.lock.chromium.version='999.0.0.0';await f.save();await assert.rejects(loadBuildInputs(f.root),/DEPS_MISMATCH/)})
test('rejects wrong Fork origin',async t=>{const f=await fixture(t);git(path.join(f.root,f.lock.sources.electron.path),'remote','set-url','origin','https://example.invalid/electron');await assert.rejects(loadBuildInputs(f.root),/SOURCE_MISMATCH/)})
test('rejects source HEAD drift',async t=>{const f=await fixture(t);const p=path.join(f.root,f.lock.sources.electron.path);git(p,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-qm','drift');await assert.rejects(loadBuildInputs(f.root),/SOURCE_MISMATCH/)})
test('rejects changed submodule mapping',async t=>{const f=await fixture(t);git(f.root,'config','-f','.gitmodules','submodule.electron.path','elsewhere');await assert.rejects(loadBuildInputs(f.root),/SUBMODULE_MISMATCH/)})
