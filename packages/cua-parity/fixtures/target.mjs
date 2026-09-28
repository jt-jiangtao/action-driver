let count=0
export async function run(input){if(input==='late-crash'){setTimeout(()=>process.exit(7),30);return 1}if(input==='json-error')throw new Error('JSON unavailable');if(input==='throw')throw Object.assign(new Error('failed'),{code:'TEST_ERROR'});if(input==='hang')await new Promise(()=>{});if(input==='crash')process.exit(4);if(input==='invalid')return undefined;return ++count}
