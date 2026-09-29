import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { validatePrerequisites, ensureBoundary, installNode } from '../../../../../scripts/lib/browser-forks/prepare.mjs'
import { digest } from '../../../../../scripts/lib/browser-forks/inputs.mjs'
const good = { platform: 'darwin', arch: 'arm64', sdkVersion: '26.5', metalAvailable: true, freeBytes: 150e9 }
test('rejects unsupported platform and missing SDK or Metal', () => {
  for (const [key,value] of [['platform','linux'],['arch','x64'],['sdkVersion','27.0'],['metalAvailable',false],['freeBytes',1]]) assert.throws(() => validatePrerequisites({ ...good, [key]: value }), /PREREQUISITE_MISSING/)
  assert.doesNotThrow(() => validatePrerequisites(good))
})
async function fixture(t) { const root=await mkdtemp(path.join(tmpdir(),'prepare '));t.after(()=>rm(root,{recursive:true,force:true}));return root }
test('conflicting package boundary is preserved',async t=>{
  const root=await fixture(t);const file=path.join(root,'package.json');await writeFile(file,'{"type":"module"}')
  await assert.rejects(ensureBoundary(file),/CONFIG_CONFLICT/);assert.equal(await readFile(file,'utf8'),'{"type":"module"}')
})
test('checksum failure never extracts or activates a tool',async t=>{
  const root=await fixture(t);const file=path.join(root,'archive');await writeFile(file,'bad');let extracted=false
  await assert.rejects(installNode({root,lock:{tools:{node:{version:'22.23.3',sha256:digest('good')}}}}, {archive:file,extract:async()=>{extracted=true}}),/CHECKSUM_MISMATCH/)
  assert.equal(extracted,false)
})
test('unpack failure preserves an existing installation',async t=>{
  const root=await fixture(t);const archive=path.join(root,'archive');await writeFile(archive,'good')
  const previous=path.join(root,'thirdparty/tools/node-previous/bin/node');await mkdir(path.dirname(previous),{recursive:true});await writeFile(previous,'existing-tool')
  await assert.rejects(installNode({root,lock:{tools:{node:{version:'22.23.3',sha256:digest('good')}}}}, {archive,extract:async()=>{throw new Error('unpack-failed')}}),/unpack-failed/)
  assert.equal(await readFile(previous,'utf8'),'existing-tool')
})
