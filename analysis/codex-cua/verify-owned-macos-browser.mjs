import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const output = dirname(fileURLToPath(import.meta.url))
const root = join(output, '..', '..')
const { build } = createRequire(join(root, 'apps/agent-runtime/package.json'))('esbuild')
const hostModule = join(root, 'apps/desktop/out/tools/local-browser-host.mjs')
await mkdir(dirname(hostModule), { recursive: true })
await build({ entryPoints: [join(root, 'apps/desktop/src/main/browser-session/local-browser-host.ts')],
  outfile: hostModule, bundle: true, platform: 'node', format: 'esm',
  external: ['playwright-core', '@actiondriver/browser-runtime'] })
const { createLocalBrowserHost } = await import(pathToFileURL(hostModule).href)
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end('<!doctype html><title>ActionDriver fixture</title><h1 id="ready">Ready</h1><input id="entry" onkeydown="if(event.key===\'Enter\')document.body.dataset.enter=\'yes\'"><button id="submit" onclick="document.querySelector(\'#ready\').textContent=document.querySelector(\'#entry\').value" ondblclick="document.body.dataset.doubleClick=\'yes\'">Apply</button>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw Error('Local fixture failed to bind')
const profileRoot = await mkdtemp(join(tmpdir(), 'actiondriver-owned-browser-'))
let host
try {
  host = await createLocalBrowserHost({ profileRoot })
  await host.setup({ environment: 'training' })
  const browser = (await host.execute({ type: 'list_browsers' }))[0]
  assert.equal(browser.id, 'local')
  const tab = await host.execute({ type: 'create_tab', browser_id: browser.id })
  const url = `http://127.0.0.1:${address.port}/`
  await host.execute({ type: 'navigate_tab_url', browser_id: browser.id, tab_id: tab.id, url })
  const state = await host.execute({ type: 'get_tab', browser_id: browser.id, tab_id: tab.id })
  assert.equal(state.title, 'ActionDriver fixture')
  const cdp = await host.execute({ type: 'tab_cdp_call', browser_id: browser.id, tab_id: tab.id,
    method: 'Runtime.evaluate', params: {
      expression: 'document.querySelector("#ready").textContent', returnByValue: true
    } })
  assert.equal(cdp.result.value, 'Ready')
  const bounds = await host.execute({ type: 'tab_cdp_call', browser_id: browser.id, tab_id: tab.id,
    method: 'Runtime.evaluate', params: {
      expression: 'JSON.stringify(Object.fromEntries(["entry", "submit"].map(id => {const r=document.getElementById(id).getBoundingClientRect(); return [id,{x:r.x+r.width/2,y:r.y+r.height/2}]})))',
      returnByValue: true
    } })
  const targets = JSON.parse(bounds.result.value)
  await host.execute({ type: 'cua_click', browser_id: browser.id, tab_id: tab.id, ...targets.entry })
  await host.execute({ type: 'cua_type', browser_id: browser.id, tab_id: tab.id, text: 'Owned input' })
  await host.execute({ type: 'cua_keypress', browser_id: browser.id, tab_id: tab.id, keys: ['ENTER'] })
  await host.execute({ type: 'cua_move', browser_id: browser.id, tab_id: tab.id, ...targets.submit })
  await host.execute({ type: 'cua_double_click', browser_id: browser.id, tab_id: tab.id, ...targets.submit })
  await host.execute({ type: 'cua_drag', browser_id: browser.id, tab_id: tab.id,
    path: [targets.submit, { x: targets.submit.x + 20, y: targets.submit.y + 20 }] })
  await host.execute({ type: 'cua_click', browser_id: browser.id, tab_id: tab.id, ...targets.submit })
  const changed = await host.execute({ type: 'tab_cdp_call', browser_id: browser.id, tab_id: tab.id,
    method: 'Runtime.evaluate', params: {
      expression: 'document.querySelector("#ready").textContent', returnByValue: true
    } })
  assert.equal(changed.result.value, 'Owned input')
  const interaction = await host.execute({ type: 'tab_cdp_call', browser_id: browser.id,
    tab_id: tab.id, method: 'Runtime.evaluate', params: {
      expression: 'JSON.stringify(document.body.dataset)', returnByValue: true
    } })
  assert.deepEqual(JSON.parse(interaction.result.value), { enter: 'yes', doubleClick: 'yes' })
  const screenshot = await host.execute({ type: 'tab_screenshot', browser_id: browser.id, tab_id: tab.id })
  const image = Buffer.from(screenshot.data, 'base64')
  assert.ok(image.length > 100)
  await writeFile(join(output, 'owned-macos-browser-fixture.png'), image)
  await host.close()
  host = undefined
  const remainingProfileEntries = await readdir(profileRoot)
  assert.deepEqual(remainingProfileEntries, [])
  const evidence = {
    platform: process.platform,
    browserExecutable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    fixture: '127.0.0.1 offline HTTP',
    checks: ['list_browsers', 'create_tab', 'navigate_tab_url', 'get_tab',
      'tab_cdp_call', 'cua_click', 'cua_type', 'cua_keypress', 'cua_move',
      'cua_double_click', 'cua_drag', 'tab_screenshot', 'profile-cleanup'],
    title: state.title,
    cdpValue: cdp.result.value,
    inputResult: changed.result.value,
    screenshotBytes: image.length,
    screenshotSha256: createHash('sha256').update(image).digest('hex'),
    remainingProfileEntries
  }
  await writeFile(join(output, 'owned-macos-browser-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify(evidence))
} finally {
  if (host) await host.close()
  await rm(profileRoot, { recursive: true, force: true })
  server.close()
}
