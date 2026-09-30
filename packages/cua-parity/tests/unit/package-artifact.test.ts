// @vitest-environment node
import { test, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const execute = promisify(execFile)
for (const name of ['cua', 'cua-repl', 'browser-runtime', 'sky']) {
  test(`${name} private artifact includes exported builds/resources and excludes source/fixtures`, async () => {
    const root = resolve('packages', name),
      work = await mkdtemp(join(tmpdir(), 'cua-artifact-'))
    try {
      await execute('corepack', ['pnpm', 'exec', 'tsc', '-p', 'tsconfig.build.json'], { cwd: root })
      const packed = await execute(
        'corepack',
        ['pnpm', 'pack', '--json', '--pack-destination', work],
        { cwd: root }
      )
      const parsed = JSON.parse(packed.stdout)
      const result = Array.isArray(parsed) ? parsed[0] : parsed
      const paths = result.files.map((file: { path: string }) => file.path)
      expect(paths).toContain('dist/index.js')
      if (name === 'cua-repl') {
        expect(paths).toContain('bin/cua-repl.mjs')
        expect(paths).toContain('plugin/.mcp.template.json')
        expect(paths).toContain('plugin/.codex-plugin/plugin.json')
      }
      if (name === 'browser-runtime') {
        expect(paths).toContain('resources/browser-documentation.json')
        expect(paths).toContain('resources/browser-keyboard.json')
      }
      expect(
        paths.some((path: string) => /^(src|tests|node_modules|vendor|back|backup)\//.test(path))
      ).toBe(false)
      const unpacked = join(work, 'unpacked')
      await mkdir(unpacked)
      await execute('tar', [
        '-xzf',
        result.filename.startsWith('/') ? result.filename : join(work, result.filename),
        '-C',
        unpacked
      ])
      const packageRoot = join(unpacked, 'package')
      const entryMap = JSON.parse(await readFile(join(packageRoot, 'dist/index.js.map'), 'utf8'))
      expect(entryMap.sources).toContain('../src/index.ts')
      expect(entryMap.sourcesContent?.[0]).toContain('export')
      await readFile(join(packageRoot, 'dist/index.d.ts.map'))
      if (name === 'browser-runtime') {
        const map = JSON.parse(await readFile(join(packageRoot, 'dist/service.js.map'), 'utf8'))
        expect(map.sources).toContain('../src/service.ts')
        expect(map.sourcesContent?.[0]).toContain('createBrowserService')
        await readFile(join(packageRoot, 'dist/index.d.ts.map'))
      }
      const metadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
      expect(metadata.private).toBe(true)
      if (name === 'cua-repl') {
        expect(metadata.bin?.['cua-repl']).toBe('bin/cua-repl.mjs')
        await readFile(join(packageRoot, metadata.bin['cua-repl']))
      }
      for (const entry of Object.values(metadata.exports) as Array<{
        import: string
        types: string
      }>) {
        await readFile(join(packageRoot, entry.import))
        await readFile(join(packageRoot, entry.types))
      }
      // Match the repository's pinned Node type toolchain instead of resolving '*'
      // from SDK transitive dependencies against newer registry metadata.
      const repositoryMetadata = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
      const overrides: Record<string, string> =
        name === 'cua' || name === 'browser-runtime' || name === 'cua-repl'
          ? { '@types/node': repositoryMetadata.devDependencies['@types/node'] }
          : {}
      if (name === 'cua' || name === 'cua-repl') {
        for (const dependency of name === 'cua' ? ['browser-runtime', 'sky'] : ['cua', 'browser-runtime', 'sky']) {
          const dependencyRoot = resolve('packages', dependency)
          await execute('corepack', ['pnpm', 'exec', 'tsc', '-p', 'tsconfig.build.json'], {
            cwd: dependencyRoot
          })
          const archive = join(work, dependency + '.tgz')
          await execute('corepack', ['pnpm', 'pack', '--out', archive], { cwd: dependencyRoot })
          overrides['@action-driver/' + dependency] = 'file:' + archive
          if (name === 'cua' || dependency === 'cua')
            expect(metadata.dependencies['@action-driver/' + dependency]).toBe('0.1.0')
        }
      }
      if (name === 'sky') {
        await writeFile(join(packageRoot, 'package.json'),
          JSON.stringify({ ...metadata, devDependencies: {} }))
      }
      if (Object.keys(overrides).length) {
        // Local packed dependencies substitute registry delivery, never workspace source paths.
        await writeFile(
          join(packageRoot, 'pnpm-workspace.yaml'),
          'packages: []\n' +
            'overrides:\n' +
            Object.entries(overrides)
              .map(([key, value]) => '  ' + JSON.stringify(key) + ': ' + JSON.stringify(value))
              .join('\n') +
            '\n'
        )
      }
      if (name === 'sky' || name === 'browser-runtime' || name === 'cua' || name === 'cua-repl') {
        await execute('corepack', ['pnpm@12.4.1', 'install', '--offline', '--prod', '--ignore-scripts'], {
          cwd: packageRoot
        })
        const lock = await readFile(join(packageRoot, 'pnpm-lock.yaml'), 'utf8')
        await execute(
          'corepack',
          ['pnpm@12.4.1', 'install', '--offline', '--frozen-lockfile', '--prod', '--ignore-scripts'],
          { cwd: packageRoot }
        )
        expect(await readFile(join(packageRoot, 'pnpm-lock.yaml'), 'utf8')).toBe(lock)
      }
      const checks: Record<string, string> = {
        cua: `globalThis.fetch=async()=>{throw Error('unexpected network')};globalThis.nodeRepl={env:{CUA_REPL_ENABLED_SURFACES:'computer',TINYSKY_ALT_INITIALIZE_DOCS:'core-node-repl'},rpc:async(service,request)=>{if(service==='sky')return request.type==='setup'?{target:'mac',methods:['list_apps']}:[];if(request.method==='setup')return {apiManifest:{interfaces:{Agent:{},Browsers:{},Documentation:{}}},disabledMemberIds:[]};if(request.params.type==='list_browsers')return [];throw Error('unexpected request')}};const api=await import(url('dist/index.js')); const reader=api.createDocumentationReader(); const text=await reader.readDocumentation('core-node-repl'); if(!text.length)throw Error('missing docs'); const session=await api.createCUASession({getHost:()=>undefined}); const state=await session.getState(); if(state.apps.length||state.browsers.length)throw Error('unexpected state');if(api.cua.computer!==null)throw Error('legacy initialized early');try{await api.cua.initialize();throw Error('unexpected host-free legacy success')}catch(error){if(!String(error).includes('BROWSER_HOST_UNAVAILABLE'))throw error}try{await import(url('dist/tinysky-alt.js'));throw Error('unexpected host-free success')}catch(error){if(!String(error).includes('CUA_REPL_ENABLED_SURFACES is required'))throw error}`,
        'cua-repl': `const api=await import(url('dist/index.js')); const instructions=api.loadInstructions('darwin'); if(!instructions.browser.length||!instructions.server.length)throw Error('missing instructions');`,
        'browser-runtime': `const require=createRequire(url('dist/index.js'));if(require('zod/package.json').version!=='3.25.76')throw Error('wrong schema version');if(require('@statsig/js-client/package.json').version!=='3.33.1')throw Error('wrong browser Statsig version');const sdk=require('@statsig/js-client');const sdkClient=new sdk.StatsigClient('client-offline-artifact',{userID:'initial'},{disableStorage:true,loggingEnabled:'disabled',logLevel:sdk.LogLevel.None,networkConfig:{preventAllNetworkTraffic:true}});try{await sdkClient.initializeAsync();sdkClient.updateUserSync({userID:'changed'});if(sdkClient.getContext().user.userID!=='changed')throw Error('SDK identity')}finally{await sdkClient.shutdown()};if(require('classic-level/package.json').version!=='3.0.0')throw Error('wrong LevelDB version');const {ClassicLevel}=require('classic-level');const database=new ClassicLevel(join(process.argv[1],'artifact-db'),{valueEncoding:'utf8'});try{await database.open();await database.put('test','value');if(await database.get('test')!=='value')throw Error('database roundtrip')}finally{await database.close()};if(require('@sentry/node/package.json').version!=='10.48.0')throw Error('wrong Sentry version');const sentry=require('@sentry/node');const errorAdapter=await import(url('dist/service-error-reporter.js'));const envelopes=[];const reporter=new errorAdapter.BrowserErrorReporter().get({env:{},fetch:async(address,options)=>{envelopes.push(options.body);return {status:200,headers:new Map()}}});try{reporter.captureException(new Error('artifact-error-reporter'));await sentry.flush(1000);if(!envelopes.some(body=>String(body).includes('artifact-error-reporter')))throw Error('missing SDK envelope')}finally{await sentry.close(1000)};if(require('playwright-core/package.json').version!=='1.59.0')throw Error('wrong Playwright version');const injected=await import(url('dist/service-playwright-injected.js'));const {runInNewContext}=await import('node:vm');const realm={};runInNewContext(injected.playwrightInjectedSource(),realm);if(typeof realm.PlaywrightInjected.InjectedScript.prototype.incrementalAriaSnapshot!=='function')throw Error('missing packed injected helper');const keyboard=await import(url('dist/service-keyboard-input.js'));const events=[];await keyboard.dispatchKeys({platform:'darwin',call:async(id,method,params)=>events.push(params)},1,['Meta','a']);if(events.length!==4||events[1].commands?.[0]!=='selectAll')throw Error('packed keyboard data missing');const api=await import(url('dist/index.js')); const transport=new api.FunctionAgentTransport({executeAgentCommand:async()=>({tabs:[]})}); if(typeof transport.send!=='function')throw Error('missing transport');const service=await import(url('dist/service.js'));if(typeof service.handleRpc!=='function')throw Error('missing browser service entry');`,
        sky: `const api=await import(url('dist/service.js')); if(typeof api.handleRpc!=='function')throw Error('missing service');const require=createRequire(url('dist/service.js'));if(require('@statsig/js-client/package.json').version!=='3.32.6')throw Error('wrong SDK');const sdk=require('@statsig/js-client');globalThis.fetch=async()=>{throw Error('unexpected network')};const client=new sdk.StatsigClient('client-offline-artifact',{userID:'initial'},{disableStorage:true,loggingEnabled:'disabled',logLevel:sdk.LogLevel.None,networkConfig:{preventAllNetworkTraffic:true}});try{await client.initializeAsync();client.updateUserSync({userID:'updated'});client.logEvent('offline-artifact');if(client.getContext().user.userID!=='updated')throw Error('wrong user')}finally{await client.shutdown()}`
      }
      if (name === 'browser-runtime') {
        const qrPng = await readFile(resolve('packages/browser-runtime/tests/fixtures/auth-qr.png'))
        checks[name] += `if(require('markdown-it/package.json').version!=='14.1.1')throw Error('wrong Markdown version');const rich=await import(url('dist/service-rich-text.js'));if(rich.renderMarkdownRichText('**bold**')!=='<strong>bold</strong>')throw Error('packed rich text failed');`
        checks[name] += `const qr=require('zxing-wasm/reader');if(qr.ZXING_WASM_VERSION!=='3.1.2')throw Error('wrong QR dependency');const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');const qrWasm=await readFile(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));if(createHash('sha256').update(qrWasm).digest('hex')!=='0e8d688d71932ebb6b8b33f700d43d3cb997f59ed9cab3c05102d7f10288a392')throw Error('wrong QR WASM');const decoder=await import(url('dist/service-auth-qr-wasm.js'));const decoded=await decoder.decodeAuthQrWithWasm('data:image/png;base64,${qrPng.toString('base64')}',{filesystem:{readBytes:async(path)=>await readFile(path)}});if(decoded?.payload!=='https://example.com/signin')throw Error('packed QR decoder failed');`
      }
      const script = `import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {join} from 'node:path';const url=(name)=>pathToFileURL(join(process.argv[1],name)).href;${checks[name]}`
      await execute(process.execPath, ['--input-type=module', '-e', script, packageRoot], {
        cwd: work
      })
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }, 30000)
}
