import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {parseBuildArgs,runPipeline,stageResult} from '../../../../../scripts/lib/browser-forks/pipeline.mjs'
async function fixture(t){const root=await mkdtemp(path.join(tmpdir(),'pipeline '));t.after(()=>rm(root,{recursive:true,force:true}));const calls=[];const context={root,jobs:8,lock:{test:'input'}};const stages={};for(const name of ['prepare','sync','build','export','verify','package'])stages[name]=async c=>{calls.push(name);const output=path.join(root,name+'.output');await writeFile(output,name);return stageResult(c,[output])};return {root,calls,context,stages}}
test('CLI rejects unknown stages and invalid jobs',()=>{assert.deepEqual(parseBuildArgs(['all']),{stage:'all',jobs:8});for(const a of [['unknown'],['all','--jobs','0'],['all','--jobs','1.5'],['build','--from','sync'],['all','--from','all'],['all','--unknown']])assert.throws(()=>parseBuildArgs(a),/ARGUMENT_INVALID/)})
test('executes all stages in order',async t=>{const f=await fixture(t);await runPipeline(f.context,{stage:'all'},f.stages);assert.deepEqual(f.calls,['prepare','sync','build','export','verify','package'])})
test('child failure stops later stages and records failure',async t=>{const f=await fixture(t);f.stages.build=async()=>{f.calls.push('build');throw new Error('compile-failure')};await assert.rejects(runPipeline(f.context,{stage:'all'},f.stages),/compile-failure/);assert.deepEqual(f.calls,['prepare','sync','build']);const state=JSON.parse(await readFile(path.join(f.root,'thirdparty/build/browser-forks/state.json'),'utf8'));assert.equal(state.stages.build.status,'failed')})
test('resume rejects missing prerequisite state',async t=>{const f=await fixture(t);await assert.rejects(runPipeline(f.context,{stage:'all',from:'build'},f.stages),/RESUME_INVALID/);assert.equal(f.calls.length,0)})
test('resume rejects changed input and tampered outputs',async t=>{const f=await fixture(t);await runPipeline(f.context,{stage:'all'},f.stages);f.context.lock.test='changed';await assert.rejects(runPipeline(f.context,{stage:'all',from:'build'},f.stages),/RESUME_INVALID/);f.context.lock.test='input';await writeFile(path.join(f.root,'sync.output'),'tampered');await assert.rejects(runPipeline(f.context,{stage:'all',from:'build'},f.stages),/RESUME_INVALID/)})
test('resume rejects success marker without output',async t=>{const f=await fixture(t);await runPipeline(f.context,{stage:'all'},f.stages);await rm(path.join(f.root,'prepare.output'));await assert.rejects(runPipeline(f.context,{stage:'all',from:'build'},f.stages),/RESUME_INVALID/)})
test('concurrent run cannot acquire an active lock',async t=>{const f=await fixture(t);let release;let entered;const ready=new Promise(r=>{entered=r});const hold=new Promise(r=>{release=r});f.stages.prepare=async c=>{entered();await hold;return stageResult(c,[])};const first=runPipeline(f.context,{stage:'prepare'},f.stages);await ready;await assert.rejects(runPipeline(f.context,{stage:'prepare'},f.stages),/BUILD_ACTIVE/);release();await first})
test('resume rejects forged successful state with an empty output list',async t=>{
 const f=await fixture(t);await runPipeline(f.context,{stage:'all'},f.stages)
 const statePath=path.join(f.root,'thirdparty/build/browser-forks/state.json')
 const state=JSON.parse(await readFile(statePath,'utf8'))
 state.stages.prepare={...await stageResult(f.context,[]),status:'success'}
 await writeFile(statePath,JSON.stringify(state))
 await assert.rejects(runPipeline(f.context,{stage:'all',from:'build'},f.stages),/RESUME_INVALID/)
})
