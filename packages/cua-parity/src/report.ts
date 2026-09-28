import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { assertJson } from './json.js'
import type { Baseline, CaseSpec, Difference, NormalizationRule, Outcome } from './types.js'
export async function writeReport(
  output: string,
  data: {
    baseline: Baseline
    spec: CaseSpec
    reference: Outcome
    candidate: Outcome
    differences: Difference[]
    rules: NormalizationRule[]
  }
): Promise<void> {
  assertJson(data)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(data, null, 2) + '\n')
}
