import { pathToFileURL } from 'node:url'
export async function run({targetEntry,input,emit}){const target=await import(pathToFileURL(targetEntry).href);console.log('fixture-log');emit({kind:'call',name:'run',payload:input});const result=await target.run(input);emit({kind:'cleanup',name:'done',payload:null});return result}
