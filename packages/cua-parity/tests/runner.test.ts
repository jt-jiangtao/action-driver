// @vitest-environment node
import { expect, test } from 'vitest'
import { fileURLToPath } from 'node:url'
import { runCase } from '../src/runner'
const target = fileURLToPath(new URL('../fixtures/target.mjs', import.meta.url))
const scenarioModule = fileURLToPath(new URL('../fixtures/scenario.mjs', import.meta.url))
function run(input: unknown) {
  return runCase(target, { id: 'fixture', scenarioModule, input, timeoutMs: 400 })
}
test('isolates module state and keeps logs outside IPC results', async () => {
  const a = await run(null),
    b = await run(null)
  expect(a.status).toBe('returned')
  expect(a.value).toBe(1)
  expect(b.value).toBe(1)
  expect(a.stdout).toContain('fixture-log')
  expect(a.trace.map((t) => t.kind)).toEqual(['call', 'cleanup'])
})
test('preserves thrown errors', async () => {
  expect((await run('throw')).error).toEqual({
    name: 'Error',
    message: 'failed',
    code: 'TEST_ERROR'
  })
})
test('timeout and crash never report success', async () => {
  expect((await run('hang')).status).toBe('timeout')
  expect((await run('crash')).status).toBe('crashed')
})
test('non JSON result and input fail explicitly', async () => {
  expect((await run('invalid')).status).toBe('protocol-error')
  expect((await run(BigInt(1))).status).toBe('protocol-error')
})
test('a result followed by a nonzero exit is a crash', async () => {
  expect((await run('late-crash')).status).toBe('crashed')
})
test('a user error mentioning JSON is still a thrown error', async () => {
  expect((await run('json-error')).status).toBe('threw')
})
