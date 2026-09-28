class ProtocolError extends Error {}
import { pathToFileURL } from 'node:url'
function validate(value, parents = new Set()) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return
  if (
    typeof value !== 'object' ||
    parents.has(value) ||
    (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)
  )
    throw new ProtocolError('Value is not plain JSON')
  parents.add(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) throw new ProtocolError('Sparse JSON array')
      validate(value[i], parents)
    }
  } else {
    if (Object.getOwnPropertySymbols(value).length)
      throw new ProtocolError('Symbol keys are not JSON')
    for (const v of Object.values(value)) validate(v, parents)
  }
  parents.delete(value)
}
// Keep the process alive until the host finishes or terminates it.
const keepAlive = setInterval(() => {}, 1000)
process.once('message', async ({ targetEntry, spec }) => {
  const trace = []
  let result
  try {
    const scenario = await import(pathToFileURL(spec.scenarioModule).href)
    const value = await scenario.run({
      targetEntry,
      input: spec.input,
      emit: (t) => {
        validate(t)
        trace.push(t)
      }
    })
    validate(value)
    result = { status: 'returned', value, error: null, trace }
  } catch (error) {
    result = {
      status: 'threw',
      value: null,
      error: {
        name: error?.name ?? 'Error',
        message: String(error?.message ?? error),
        code: typeof error?.code === 'string' ? error.code : null
      },
      trace
    }
    if (error instanceof ProtocolError) result.status = 'protocol-error'
  }
  process.send(result, () => {
    clearInterval(keepAlive)
    process.disconnect()
  })
})
