/** Resource data extraction only; production never executes the legacy service. */
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const sourcePath='apps/agent-runtime/vendor/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-service.mjs'
const source=await readFile(sourcePath,'utf8')
const module=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {xy as resources};').toString('base64'))
const data=JSON.stringify(module.resources,null,2)+'\n',output='packages/browser-runtime/resources/browser-documentation.json'
await writeFile(output,data)
await writeFile('analysis/codex-cua/browser-resource-provenance.json',JSON.stringify({sourcePath,sourceSha256:createHash('sha256').update(source).digest('hex'),output,outputSha256:createHash('sha256').update(data).digest('hex'),kind:'embedded resource data; no executable implementation extracted'},null,2)+'\n')
