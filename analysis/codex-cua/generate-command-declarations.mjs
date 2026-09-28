// Generates declarative first-party command contracts. Validation runs in upstream Zod.
import fs from 'node:fs'
const {commands}=JSON.parse(fs.readFileSync('analysis/codex-cua/browser-command-contracts.json','utf8'))
const quote=JSON.stringify
function emit(s){
 let expression
 switch(s.kind){
 case 'Object':expression='z.object({'+Object.entries(s.fields).map(([key,value])=>quote(key)+':'+emit(value)).join(',')+'})';if(s.unknownKeys!=='strip')expression+='.'+s.unknownKeys+'()';break
 case 'String':case 'Number':case 'Boolean':case 'Unknown':expression='z.'+s.kind.toLowerCase()+'('+(s.errorMessages?quote(s.errorMessages):'')+')';break
 case 'Optional':case 'Nullable':return emit(s.inner)+'.'+s.kind.toLowerCase()+'()'
 case 'Enum':return 'z.enum('+quote(s.values)+')'
 case 'Literal':return 'z.literal('+quote(s.value)+')'
 case 'Array':expression='z.array('+emit(s.item)+')';for(const key of ['min','max'])if(s[key])expression+='.'+key+'('+s[key].value+(s[key].message?','+quote(s[key].message):'')+')';break
 case 'Record':return 'z.record('+emit(s.key)+','+emit(s.value)+')'
 case 'Union':return 'z.union(['+s.options.map(emit).join(',')+'])'
 case 'DiscriminatedUnion':return 'z.discriminatedUnion('+quote(s.discriminator)+',['+s.options.map(emit).join(',')+'])'
 case 'Tuple':return 'z.tuple(['+s.items.map(emit).join(',')+'])'+(s.rest?'.rest('+emit(s.rest)+')':'')
 case 'Effects':return emit(s.inner)+'.superRefine('+s.refinement+'Refinement)'
 default:throw new Error('Unsupported contract '+s.kind)
 }
 for(const check of s.checks??[]){
 const message=check.message?','+quote(check.message):''
 if(check.kind==='min'&&s.kind==='Number')expression+='.'+(check.inclusive?'min':'gt')+'('+check.value+message+')'
 else if(check.kind==='min')expression+='.min('+check.value+message+')'
 else if(['int','trim','url'].includes(check.kind))expression+='.'+check.kind+'('+(check.message?quote(check.message):'')+')'
 else throw new Error('Unsupported check '+JSON.stringify(check))
 }
 return expression
}
let output="// Declarative contracts derived from the public schema inventory. No legacy implementation or schema engine is embedded.\nimport { z, defineCommand } from './definition.js'\nimport { selectionRefinement, clipboardRefinement } from './refinements.js'\nimport { TabsContent, BrowserUserGetTabContext } from './structured.js'\nimport { WebMcpListTools, WebMcpInvokeTool } from './capability.js'\nimport { AtlasCommand } from '../command.js'\n"
const reused=new Set(['TabsContent','BrowserUserGetTabContext','WebMcpListTools','WebMcpInvokeTool'])
for(const [name,def] of Object.entries(commands)){
 if(reused.has(name))continue
 const extras=Object.entries(def.schemas).filter(([key])=>!['PayloadSchema','ResultSchema'].includes(key))
 output+='export const '+name+' = '+(extras.length?'{...':'')+'defineCommand('+quote(def.type)+','+emit(def.schemas.PayloadSchema)+','+emit(def.schemas.ResultSchema)+')'+(extras.length?','+extras.map(([key,s])=>key+':'+emit(s)).join(',')+'}':'')+'\n'
}
output+='export const Commands = {AtlasCommand,'+Object.keys(commands).join(',')+'}\n'
fs.writeFileSync('packages/browser-runtime/src/commands/index.ts',output)
