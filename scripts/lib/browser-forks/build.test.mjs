import test from 'node:test'
import assert from 'node:assert/strict'
import { ninjaCommand } from './build.mjs'
test('Ninja propagates concurrency and fd limit using positional argv',()=>{
 const command=ninjaCommand({root:'/project with spaces',jobs:4,lock:{tools:{node:{version:'22.23.3'}},build:{fileLimit:65536,output:'out/ActionDriver'}}})
 assert.equal(command.file,'/bin/bash')
 assert.deepEqual(command.args.slice(3),['65536','/project with spaces/thridparty/build/electron-workspace/src/third_party/ninja/ninja','out/ActionDriver','4'])
 assert.match(command.args[1],/ulimit -n "\$1"/)
 assert.match(command.args[1],/exec "\$2" -C "\$3" -j "\$4" electron/)
})
