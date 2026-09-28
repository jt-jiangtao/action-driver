// Run from the worktree: ego-browser nodejs -e "await import('file://$PWD/analysis/codex-cua/verify-real-macos-playwright.mjs')"
// Set globalThis.EGO_TASK_SPACE_ID before import to resume this goal's isolated TaskSpace.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')
const task = globalThis.EGO_TASK_SPACE_ID
  ? await taskSpace(Number(globalThis.EGO_TASK_SPACE_ID))
  : await taskSpace('🧪 CUA candidate real DOM')
try {
  const page = task.page('p1')
  const source = await readFile(
    `${root}/packages/back/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-service.mjs`,
    'utf8'
  )
  const dependency = '../node_modules/classic-level.mjs'
  assert.ok(source.includes(dependency), 'copied service dependency path drifted')
  const classic = pathToFileURL(`${root}/packages/browser-runtime/node_modules/classic-level/index.js`).href
  const original = await import('data:text/javascript;base64,' + Buffer.from(
    source.replace(dependency, classic) + '\nexport {yf as PlaywrightInput,x_ as fillLocator};'
  ).toString('base64'))
  const candidate = {
    ...(await import(pathToFileURL(`${root}/packages/browser-runtime/dist/service-playwright-input.js`).href)),
    ...(await import(pathToFileURL(`${root}/packages/browser-runtime/dist/service-playwright-fill.js`).href))
  }
  const fixture = `<!doctype html><input id="name"><button id="go">Go</button>
    <p id="result">ready</p><p id="events">0</p><script>
    document.getElementById('go').addEventListener('click', () => {
      document.getElementById('result').textContent = 'clicked'
    })
    document.getElementById('name').addEventListener('input', () => {
      const events = document.getElementById('events')
      events.textContent = String(Number(events.textContent) + 1)
    })
    </script>`
  async function exercise(module) {
    await page.goto('data:text/html,' + encodeURIComponent(fixture))
    const cdp = {
      platform: 'darwin',
      addListener() {},
      call: (_id, method, params) => page.cdp(method, params ?? {}),
      callTarget: (_target, method, params) => page.cdp(method, params ?? {})
    }
    const pointer = []
    const cua = {
      clickPoint: async (action) => {
        pointer.push({ button: action.button, clickCount: action.clickCount,
          x: Math.round(action.point.x), y: Math.round(action.point.y) })
        await page.mouse.click(action.point.x, action.point.y, {
          button: action.button, clickCount: action.clickCount,
          label: 'verify reconstructed browser click'
        })
      }
    }
    const span = { currentPlaywrightOperation: (name) => name }
    const timing = { startLocatorRetry: () => ({ attemptFailed() {}, finish() {} }) }
    const clipboard = { runExclusive: async (run) => await run(), ensurePageClipboard: async () => {} }
    const playwright = new module.PlaywrightInput(cdp, cua, span, timing)
    const count = await playwright.evaluateOnPlaywrightSelectorAll(1, '#name', (elements) => elements.length)
    const enabled = await playwright.readElementState({ tab_id: 1, selector: '#name' }, 'enabled')
    await playwright.clickLocator({ tab_id: 1, selector: '#go', timeout_ms: 2000 }, 1)
    await module.fillLocator({ tab_id: 1, selector: '#name', value: 'real browser', timeout_ms: 2000 },
      { playwright, cdp, clipboard })
    return {
      count, enabled, pointer,
      state: await page.evaluate(() => ({
        result: document.getElementById('result').textContent,
        input: document.getElementById('name').value,
        events: document.getElementById('events').textContent
      }))
    }
  }
  const expected = await exercise(original)
  const actual = await exercise(candidate)
  assert.deepEqual(actual, expected)
  assert.deepEqual(actual.state, { result: 'clicked', input: 'real browser', events: '1' })
  console.log(JSON.stringify({ status: 'pass', browser: 'Ego Lite Chromium on macOS', expected, actual }))
} finally {
  await task.finish({ keep: [] })
}
