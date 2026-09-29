// Analysis only. Records observable public schema contracts; never imported by candidates.
import fs from 'node:fs'
import crypto from 'node:crypto'
const path='thirdparty/backup/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-client.js'
const source=fs.readFileSync(path,'utf8')
const {api}=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {s as api};').toString('base64'))
function describe(schema,path){
 const d=schema._def,kind=d.typeName.slice(3),out={kind}
 if(d.checks?.length)out.checks=d.checks
 if(d.errorMap){
 const message=(received,data)=>d.errorMap({code:'invalid_type',expected:kind.toLowerCase(),received},{data,defaultError:'__DEFAULT__'}).message
 const required=message('undefined',undefined),invalid=message('null',null)
 if(required!=='__DEFAULT__'||invalid!=='__DEFAULT__')out.errorMessages={...(required==='__DEFAULT__'?{}:{required_error:required}),...(invalid==='__DEFAULT__'?{}:{invalid_type_error:invalid})}
 }
 switch(kind){
 case 'Object':out.fields=Object.fromEntries(Object.entries(d.shape()).map(([name,s])=>[name,describe(s,path+'.'+name)]));out.unknownKeys=d.unknownKeys;break
 case 'Optional':case 'Nullable':out.inner=describe(d.innerType,path);break
 case 'Array':out.item=describe(d.type,path);if(d.minLength)out.min=d.minLength;if(d.maxLength)out.max=d.maxLength;break
 case 'Enum':out.values=d.values;break
 case 'Literal':out.value=d.value;break
 case 'Record':out.key=describe(d.keyType,path);out.value=describe(d.valueType,path);break
 case 'Union':case 'DiscriminatedUnion':out.options=d.options.map(s=>describe(s,path));if(d.discriminator)out.discriminator=d.discriminator;break
 case 'Tuple':out.items=d.items.map(s=>describe(s,path));if(d.rest)out.rest=describe(d.rest,path);break
 case 'Effects':out.inner=describe(d.schema,path);out.refinement=path.includes('SelectOption')?'selection':'clipboard';break
 case 'String':case 'Number':case 'Boolean':case 'Unknown':break
 default:throw new Error(`Unhandled schema ${kind}: ${path}`)
 }
 return out
}
const commands=Object.fromEntries(Object.entries(api.Commands).filter(([,def])=>def.PayloadSchema).map(([name,def])=>[name,{type:def.commandType,schemas:Object.fromEntries(Object.entries(def).filter(([key])=>key.endsWith('Schema')).map(([key,schema])=>[key,describe(schema,name+'.'+key)]))}]))
fs.writeFileSync('analysis/codex-cua/browser-command-contracts.json',JSON.stringify({source:path,sha256:crypto.createHash('sha256').update(source).digest('hex'),commands},null,2)+'\n')
