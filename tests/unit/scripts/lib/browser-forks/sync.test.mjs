import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assertCleanCheckout, ensureConfig } from '../../../../../scripts/lib/browser-forks/sync.mjs'
async function fixture(t) {
 const root=await mkdtemp(path.join(tmpdir(),'sync '));t.after(()=>rm(root,{recursive:true,force:true}))
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim()
 git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture')
 await writeFile(path.join(root,'source'),'original');git('add','.');git('commit','-qm','baseline');git('remote','add','origin','https://example.invalid/fork.git')
 return {root,source:{repo:'https://example.invalid/fork.git',commit:git('rev-parse','HEAD')}}
}
test('dirty source is rejected without discarding content',async t=>{const f=await fixture(t);await writeFile(path.join(f.root,'source'),'user-edit');await assert.rejects(assertCleanCheckout(f.root,f.source),/DIRTY_CHECKOUT/);assert.equal(await readFile(path.join(f.root,'source'),'utf8'),'user-edit')})
test('untracked source is also rejected',async t=>{const f=await fixture(t);await writeFile(path.join(f.root,'new-source'),'user-edit');await assert.rejects(assertCleanCheckout(f.root,f.source),/DIRTY_CHECKOUT/)})
test('wrong origin and source drift are rejected',async t=>{const f=await fixture(t);await assert.rejects(assertCleanCheckout(f.root,{...f.source,repo:'wrong'}),/SOURCE_MISMATCH/);await assert.rejects(assertCleanCheckout(f.root,{...f.source,commit:'0'.repeat(40)}),/SOURCE_MISMATCH/);await assertCleanCheckout(f.root,f.source)})
test('existing conflicting gclient configuration is preserved',async t=>{const f=await fixture(t);const file=path.join(f.root,'.gclient');await writeFile(file,'user-config');await assert.rejects(ensureConfig(file,'generated-config'),/CONFIG_CONFLICT/);assert.equal(await readFile(file,'utf8'),'user-config')})
