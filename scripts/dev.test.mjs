import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

async function fixture(t, content, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'actiondriver-dev-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bin = join(root, 'bin'),
    report = join(root, 'calls.jsonl')
  await mkdir(bin)
  const command = join(bin, 'pnpm')
  await writeFile(
    command,
    `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.DEV_TEST_REPORT, JSON.stringify({args:process.argv.slice(2), searchConfigured:!!process.env.TAVILY_API_KEY, readerConfigured:!!process.env.JINA_API_KEY, environmentPrecedence:process.env.TAVILY_API_KEY==='inherited-test'})+'\\n');
process.exit(process.env.DEV_TEST_FAIL_BUILD && process.argv.at(-1)==='build' ? 7 : 0);
`
  )
  await chmod(command, 0o700)
  if (content !== null) await writeFile(join(root, '.env.local'), content)
  const env = { ...process.env, PATH: bin + ':' + process.env.PATH, DEV_TEST_REPORT: report }
  delete env.TAVILY_API_KEY
  delete env.JINA_API_KEY
  Object.assign(env, overrides)
  const run = promisify(execFile)(process.execPath, [resolve('scripts/dev.mjs')], {
    cwd: root,
    env
  })
  return {
    run,
    calls: async () => (await readFile(report, 'utf8')).trim().split('\n').map(JSON.parse)
  }
}

test('developer startup loads ignored credentials and preserves inherited environment precedence', async (t) => {
  const f = await fixture(t, 'TAVILY_API_KEY=local-test\nJINA_API_KEY=reader-test\n', {
    TAVILY_API_KEY: 'inherited-test'
  })
  await f.run
  const calls = await f.calls()
  assert.deepEqual(
    calls.map((value) => value.args),
    [
      ['--filter', '@actiondriver/agent-runtime', 'build'],
      ['--filter', '@actiondriver/desktop', 'dev']
    ]
  )
  for (const value of calls)
    assert.deepEqual(
      [value.searchConfigured, value.readerConfigured, value.environmentPrecedence],
      [true, true, true]
    )
})

test('developer startup works without a local environment file', async (t) => {
  const f = await fixture(t, null)
  await f.run
  for (const value of await f.calls())
    assert.deepEqual([value.searchConfigured, value.readerConfigured], [false, false])
})

test('developer startup does not launch desktop after a failed runtime build', async (t) => {
  const f = await fixture(t, null, { DEV_TEST_FAIL_BUILD: '1' })
  await assert.rejects(f.run, (error) => error.code === 7)
  assert.equal((await f.calls()).length, 1)
})
