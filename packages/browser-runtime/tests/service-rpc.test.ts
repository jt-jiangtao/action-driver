// @vitest-environment node
import { test, expect } from 'vitest'
import { BrowserRpc } from '../src/service-rpc'
import { originalDocumentation } from './original-service'
async function compare(exercise: (Rpc: any) => Promise<unknown>) {
  const base = await originalDocumentation()
  expect(await exercise(BrowserRpc)).toEqual(await exercise(base.BaselineRpc))
}
function transport() {
  let receive: any, close: any
  const sent: any[] = []
  return {
    sent,
    get receive() {
      return receive
    },
    get close() {
      return close
    },
    sendMessage: (message: any) => sent.push(message),
    setMessageCallback: (callback: any) => (receive = callback),
    addCloseListener: (callback: any) => (close = callback)
  }
}
test('RPC correlates out-of-order replies, ignores unknown ids and returns original error strings', async () => {
  await compare(async (Rpc) => {
    const pipe = transport(),
      rpc = new Rpc(pipe),
      a = rpc.sendRequest('a', { x: 1 }),
      b = rpc.sendRequest(42, undefined),
      errors: any[] = []
    b.catch((error: any) => errors.push(error))
    await pipe.receive({ id: 2, error: { message: 'failed' } })
    await pipe.receive({ id: 999, result: 'ignore' })
    await pipe.receive({ id: 1, result: { ok: true } })
    rpc.sendNotification('notice', { y: 2 })
    await b.catch(() => {})
    return { result: await a, errors, sent: pipe.sent, size: rpc.pendingRequests.size }
  })
})
test('RPC synchronous write failure preserves identity and close rejects all pending with message', async () => {
  await compare(async (Rpc) => {
    const pipe = transport(),
      rpc = new Rpc(pipe),
      error = Error('write'),
      errors: any[] = []
    const write = pipe.sendMessage
    pipe.sendMessage = () => {
      throw error
    }
    try {
      await rpc.sendRequest('a')
    } catch (e) {
      expect(e).toBe(error)
    }
    pipe.sendMessage = write
    const a = rpc.sendRequest('b').catch((e: any) => errors.push(e)),
      b = rpc.sendRequest('c').catch((e: any) => errors.push(e))
    pipe.close(Error('closed'))
    await Promise.all([a, b])
    return { errors, size: rpc.pendingRequests.size }
  })
})
test('RPC registers own and prototype handlers with receiver and emits serialized handler errors', async () => {
  await compare(async (Rpc) => {
    const pipe = transport(),
      rpc = new Rpc(pipe)
    class Handlers {
      prefix = 'prefix'
      own = (value: string) => this.prefix + value
      ok(value: string) {
        return this.prefix + value
      }
      bad() {
        throw 99
      }
    }
    rpc.registerRequestHandlerObject(new Handlers())
    for (const method of ['own', 'ok', 'bad', 'missing'])
      await pipe.receive({ id: method, method, params: 'value' })
    return pipe.sent
  })
})
test('RPC event registration retains order and removes every matching callback', async () => {
  await compare(async (Rpc) => {
    const pipe = transport(),
      rpc = new Rpc(pipe),
      calls: any[] = []
    const a = (value: any) => calls.push(['a', value]),
      b = (value: any) => calls.push(['b', value])
    rpc.addEventListener(1, a)
    rpc.addEventListener(1, b)
    rpc.addEventListener(1, a)
    await pipe.receive({ method: '1', params: 2 })
    rpc.removeEventListener(1, a)
    await pipe.receive({ method: '1', params: 3 })
    await pipe.receive({})
    return calls
  })
})
