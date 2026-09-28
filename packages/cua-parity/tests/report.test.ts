// @vitest-environment node
import { expect, test } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeReport } from '../src/report'
import type { Outcome } from '../src/types'
test('preserves raw outcomes and rejects unencodable evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cua-report-'))
  const o: Outcome = {
    status: 'returned',
    value: { id: 1 },
    error: null,
    trace: [],
    stdout: '',
    stderr: ''
  }
  const data = {
    baseline: { schemaVersion: 1 as const, packages: {}, files: [] },
    spec: { id: 'x', scenarioModule: 'fixture', input: null, timeoutMs: 100 },
    reference: o,
    candidate: { ...o, value: { id: 2 } },
    differences: [],
    rules: [{ path: '/value/id', reason: 'fixture' }]
  }
  try {
    await writeReport(join(root, 'a.json'), data)
    expect(JSON.parse(await readFile(join(root, 'a.json'), 'utf8')).candidate.value.id).toBe(2)
    await expect(
      writeReport(join(root, 'bad.json'), { ...data, reference: { ...o, value: undefined } })
    ).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
