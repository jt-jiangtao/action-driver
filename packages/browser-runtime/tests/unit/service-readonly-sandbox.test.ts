// @vitest-environment node
import {test,expect} from 'vitest'
import {JSDOM} from 'jsdom'
import {originalDocumentation} from '../original-service'
const own=async()=>await import('../../src/service-readonly-sandbox').catch(()=>({})) as any
test('readonly script input guard and CDP result decoding match original',async()=>{
 const candidate=await own();expect(typeof candidate.readonlyExpression).toBe('function');const base=await originalDocumentation()
 for(const script of ['return 3','return import("mod")','return import /*comment*/("mod")','const text="import(x)";return text']){
  let a,b;try{candidate.assertReadonlyScript(script);a='ok'}catch(e:any){a=e.message}try{base.baselineReadonlyGuard(script);b='ok'}catch(e:any){b=e.message}expect(a).toBe(b)
 }
 for(const response of [{result:{value:{x:1}}},{result:{unserializableValue:'NaN'}},{result:{unserializableValue:'42n'}},{exceptionDetails:{text:'not allowed'}}]){
  let a,b;try{a=candidate.readonlyResult(response)}catch(e:any){a=e.message}try{b=base.baselineReadonlyResult(response)}catch(e:any){b=e.message}expect(a).toEqual(b)
 }
})
test('readonly DOM evaluation, mutation blocking and bounded serialization match original in isolated page realms',async()=>{
 const candidate=await own();expect(typeof candidate.readonlyExpression).toBe('function');const base=await originalDocumentation()
 async function exercise(factory:any,script:string){const dom=new JSDOM('<body><h1 id="title">Hello</h1><input id="password" type="password" value="secret"></body>',{runScripts:'outside-only',pretendToBeVisual:true,url:'https://example.test/path?secret=1'}),w=dom.window;let value,error
  try{value=await w.eval(factory(script))}catch(e:any){error=e.message}const state={value,error,html:w.document.body.innerHTML};w.close();return state
 }
 for(const script of ["return document.querySelector('h1').textContent","return document.querySelector('input').value","document.querySelector('h1').textContent='Changed';return 1","return [location.href,document.title,document.querySelectorAll('h1').length]","return {number:Infinity,big:12n,repeat:'x'.repeat(200100)}"]){
  expect(await exercise(candidate.readonlyExpression,script)).toEqual(await exercise(base.baselineReadonlyExpression,script))
 }
})
test('readonly facades preserve selectors, attribute privacy and immutable browser APIs',async()=>{
 const candidate=await own(),base=await originalDocumentation()
 async function exercise(factory:any,script:string){const dom=new JSDOM('<body><section id="root" data-count="3"><input id="password" type="password" value="secret"><a href="/next">Next</a></section></body>',{runScripts:'outside-only',url:'https://example.test/page?query=secret'}),w=dom.window;let value,error
  try{value=await w.eval(factory(script))}catch(e:any){error=e.message}const state={value,error,html:w.document.body.innerHTML};w.close();return state
 }
 for(const script of [
  "return document.querySelector('#root').dataset.count",
  "return document.querySelectorAll('input').map(node=>[node.getAttribute('value'),node.attributes.getNamedItem('value'),node.outerHTML])",
  "return document.querySelector('a').getAttribute('href')",
  "return document.querySelector('#root').classList.length",
  "document.querySelector('#root').setAttribute('data-count','4');return 1",
  "window.fetch('https://example.test/steal');return 1",
  "return Array.from(document.querySelectorAll('a')).map(node=>node.textContent)",
  "return [window.location.href,document.location.href]"
 ])expect(await exercise(candidate.readonlyExpression,script)).toEqual(await exercise(base.baselineReadonlyExpression,script))
})
