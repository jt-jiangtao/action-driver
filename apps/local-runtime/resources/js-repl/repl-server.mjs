// Sandboxed, stateful JavaScript entry for the agent (the `js` / `js_reset` tools).
//
// The host owns every privileged operation: `sky.*` calls and image emission travel back over
// stdio, so permissions, gating and confirmation stay in the runtime. This process only evaluates
// model-authored JavaScript.
//
// One call = one ES module in a persistent `vm` context. Modules give the documented semantics for
// free: top-level `await`, a fresh lexical scope per call (so `const` can be redeclared), and one
// shared global object. Values reach the next call through a synthetic `@prev` module that carries
// the previous cell's top-level bindings forward.
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import vm from 'node:vm'
import { buildCell } from './bindings.mjs'

const SKY_METHODS = [
  'list_apps', 'get_app_state', 'click', 'drag', 'paste', 'press_key', 'scroll',
  'select_text', 'set_value', 'type_text', 'perform_secondary_action'
]

const pending = new Map()
let nextCallId = 1
let cellCounter = 1
let requestMeta = Object.freeze({})
let cua = null

const send = (message) => { process.stdout.write(`${JSON.stringify(message)}\n`) }

function callHost(method, args) {
  const id = nextCallId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    send({ type: 'call', id, method, args })
  })
}

function stringify(value) {
  if (typeof value === 'string') return value
  try {
    const encoded = JSON.stringify(value)
    return encoded === undefined ? String(value) : encoded
  } catch { return String(value) }
}

const nodeRepl = Object.freeze({
  env: Object.freeze({ CUA_REPL_ENABLED_SURFACES: 'browser,computer', TINYSKY_ALT_INITIALIZE_DOCS: 'owned-macos' }),
  get requestMeta() { return requestMeta },
  cwd: process.env.NODE_REPL_CWD || process.cwd(),
  homeDir: process.env.HOME || process.cwd(),
  tmpDir: process.env.TMPDIR || '/tmp',
  write: (value) => { send({ type: 'text', text: stringify(value) }) },
  emitImage: (image) => {
    const bytes = image?.bytes
    // Code runs in another realm, so `instanceof` cannot be trusted here.
    const view = ArrayBuffer.isView(bytes)
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null
    if (!view) {
      throw new Error('nodeRepl.emitImage expects { bytes: Uint8Array, mimeType }')
    }
    send({
      type: 'image',
      mimeType: typeof image.mimeType === 'string' ? image.mimeType : 'image/png',
      base64: Buffer.from(view).toString('base64')
    })
  }
})

function captureConsole() {
  const write = (...parts) => { send({ type: 'text', text: parts.map(stringify).join(' ') }) }
  return {
    log: write, info: write, warn: write, error: write, debug: write,
    trace: write, dir: write, table: write
  }
}

// Every documented sky method round-trips to the host, which validates it and talks to the native
// helper (or refuses when the Skill was not loaded or the task is paused).
const sky = { target: 'mac' }
for (const method of SKY_METHODS) {
  sky[method] = (args = {}) => callHost(method, args)
}

function createContext() {
  return vm.createContext({
    console: captureConsole(),
    nodeRepl,
    sky,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    structuredClone,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask
  })
}

let context = createContext()
let previous = null

/**
 * Dynamic imports require a linked, evaluated module, so build one before handing it over.
 */
async function syntheticModule(exports, name) {
  const module = new vm.SyntheticModule(Object.keys(exports), function initialize() {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
  }, { context, identifier: name })
  await module.link(() => {})
  await module.evaluate()
  return module
}

async function carriedModule() {
  if (!previous) return null
  const exports = {}
  for (const binding of previous.bindings) {
    // A failed cell never becomes `previous`, so every carried binding is initialized except
    // `var`/`function` names a throwing cell never reached; those read as undefined.
    try { exports[binding.name] = previous.module.namespace[binding.name] }
    catch { exports[binding.name] = undefined }
  }
  return await syntheticModule(exports, '@prev')
}

async function importModule(specifier) {
  if (specifier === '@prev') {
    const module = await carriedModule()
    if (!module) throw new Error('@prev is unavailable before the first js call')
    return module
  }
  const name = specifier.replace(/^node:/, '')
  if (['child_process', 'worker_threads', 'cluster', 'inspector', 'inspector/promises', 'process'].includes(name)) {
    throw new Error(`${specifier} is unavailable in the js entry`)
  }
  // Built-ins such as node:fs/promises stay reachable, matching the bundled Node script tools.
  return await import(specifier)
}

async function evaluate(id, code) {
  requestMeta = Object.freeze({ call_id: String(id) })
  if (!cua) {
    const { createOwnedCua } = await import('./owned-cua.mjs')
    cua = await createOwnedCua(
      (input) => callHost('computer_rpc', input),
      (input) => callHost('browser_rpc', input),
      nodeRepl
    )
    Object.assign(cua, { initialize: cua.getState })
    context.cua = cua
    context.agent = globalThis.agent
  }
  const identifier = join(nodeRepl.cwd, `.js_repl_cell_${cellCounter++}.mjs`)
  const compile = (source) => new vm.SourceTextModule(source, { context, identifier })
  const built = buildCell({ code, priorBindings: previous?.bindings ?? [], compile })
  const module = new vm.SourceTextModule(built.source, {
    context,
    identifier,
    importModuleDynamically: async (specifier) => await importModule(specifier)
  })
  await module.link(async (specifier) => {
    if (specifier !== '@prev') {
      throw new Error(
        `Top-level static import "${specifier}" is not supported in the js entry. ` +
        `Use await import("${specifier}") instead.`
      )
    }
    const carried = await carriedModule()
    if (!carried) throw new Error('@prev is unavailable before the first js call')
    return carried
  })
  await module.evaluate()
  previous = { module, bindings: built.bindings }
  send({ id, ok: true, value: null })
}

async function handle(line) {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.type === 'callResult') {
    const entry = pending.get(message.id)
    pending.delete(message.id)
    if (!entry) return
    if (message.ok) entry.resolve(message.value ?? null)
    else entry.reject(new Error(message.error ?? 'sky call failed'))
    return
  }
  if (message.reset) {
    context = createContext()
    cua = null
    previous = null
    send({ id: message.id, ok: true, value: null })
    return
  }
  try {
    await evaluate(message.id, typeof message.code === 'string' ? message.code : '')
  } catch (error) {
    send({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

// Cells run one at a time; `sky` results stay out of that queue, or a cell awaiting the host would
// wait for itself.
let cells = Promise.resolve()
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.startsWith('{"type":"callResult"')) {
    void handle(line)
    return
  }
  cells = cells.then(() => handle(line)).catch(() => undefined)
})
