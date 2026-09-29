import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {runCommand} from '../../../../../scripts/lib/browser-forks/runner.mjs'
async function fixture(t){const root=await mkdtemp(path.join(tmpdir(),'runner with spaces '));t.after(()=>rm(root,{recursive:true,force:true}));return root}
test('preserves argv with spaces and explicit cwd',async t=>{const root=await fixture(t);const logPath=path.join(root,'run.log');await runCommand({file:process.execPath,args:['-e','console.log(JSON.stringify({cwd:process.cwd(),arg:process.argv[1],env:process.env.ELECTRON_RUN_AS_NODE}))','literal $value with spaces'],cwd:root,logPath,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});const text=await readFile(logPath,'utf8');assert.match(text,/literal \$value with spaces/);assert.ok(text.includes(root));assert.ok(!text.includes('"env":"1"'))})
test('rejects child failure and preserves stderr in log',async t=>{const root=await fixture(t);const logPath=path.join(root,'failure.log');await assert.rejects(runCommand({file:process.execPath,args:['-e','console.error("failed-child");process.exit(7)'],cwd:root,logPath}),/COMMAND_FAILED.*7/);assert.match(await readFile(logPath,'utf8'),/failed-child/)})
test('rejects spawn failure without hanging',async t=>{const root=await fixture(t);await assert.rejects(runCommand({file:path.join(root,'missing'),args:[],cwd:root,logPath:path.join(root,'run.log')}),/ENOENT/)})
test('forwards termination to its own child process group',async t=>{
 const root=await fixture(t),logPath=path.join(root,'signal.log')
 const script=`import {runCommand} from ${JSON.stringify(new URL('../../../../../scripts/lib/browser-forks/runner.mjs',import.meta.url).href)};try{await runCommand({file:process.execPath,args:['-e','console.log("CHILD_READY");setInterval(()=>{},1000)'],cwd:${JSON.stringify(root)},logPath:${JSON.stringify(logPath)}})}catch(error){process.exitCode=error.exitCode}`
 const controller=spawn(process.execPath,['--input-type=module','-e',script],{stdio:'ignore'})
 t.after(()=>{if(controller.exitCode===null)controller.kill('SIGKILL')})
 const exited=new Promise(resolve=>controller.once('exit',(code,signal)=>resolve({code,signal})))
 const deadline=Date.now()+5000
 while(Date.now()<deadline){let log='';try{log=await readFile(logPath,'utf8')}catch{/* The child has not created its log yet; keep polling. */}if(log.includes('CHILD_READY'))break;await new Promise(resolve=>setTimeout(resolve,20))}
 assert.match(await readFile(logPath,'utf8'),/CHILD_READY/)
 controller.kill('SIGTERM')
 const result=await exited
 assert.equal(result.code,143)
})
