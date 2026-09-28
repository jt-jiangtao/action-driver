import { assertOutputOutside } from './paths.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { captureBaseline, verifyBaseline } from './baseline.js'
import { inventory } from './inventory.js'
import { generateReadable } from './readable.js'
import { runCase } from './runner.js'
import { compareOutcomes } from './compare.js'
import { writeReport } from './report.js'
import type { Baseline, CaseSpec } from './types.js'
const [command, rootArg, baselineArg, outputArg, ...rest] = process.argv.slice(2)
if (!command || !rootArg || !baselineArg)
  throw new Error(
    'Usage: capture|verify|inventory|readable <vendor-root> <baseline.json> [output]; compare <vendor-root> <baseline.json> <report.json> <case.json> <reference-entry> <candidate-entry>'
  )
const root = resolve(rootArg),
  file = resolve(baselineArg)
if (command === 'capture') {
  await assertOutputOutside(root, file, [])
  const b = await captureBaseline(root)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(b, null, 2) + '\n')
  console.log(`Captured ${b.files.length} entries`)
} else {
  const baseline = JSON.parse(await readFile(file, 'utf8')) as Baseline
  const drift = await verifyBaseline(root, baseline)
  if (drift.length) {
    console.error(JSON.stringify(drift))
    process.exitCode = 1
  } else if (command === 'verify') console.log('Baseline matches')
  else if (command === 'inventory' && outputArg) {
    await assertOutputOutside(root, outputArg, [file])
    const items = await inventory(root, baseline)
    await writeFile(resolve(outputArg), JSON.stringify(items, null, 2) + '\n')
    console.log(`Inventoried ${items.length} entries`)
  } else if (command === 'readable' && outputArg) {
    await generateReadable(root, resolve(outputArg), baseline)
    console.log('Readable copies generated')
  } else if (command === 'compare' && outputArg && rest.length === 3) {
    const [caseFile, ref, candidate] = rest as [string, string, string]
    await assertOutputOutside(root, outputArg, [file, caseFile, ref, candidate])
    const spec = JSON.parse(await readFile(resolve(caseFile), 'utf8')) as CaseSpec
    await assertOutputOutside(root, outputArg, [spec.scenarioModule])
    const reference = await runCase(resolve(ref), spec),
      result = await runCase(resolve(candidate), spec)
    const differences = compareOutcomes(reference, result, [])
    await writeReport(resolve(outputArg), {
      baseline,
      spec,
      reference,
      candidate: result,
      differences,
      rules: []
    })
    if (
      differences.length ||
      ['timeout', 'crashed', 'protocol-error'].includes(reference.status) ||
      ['timeout', 'crashed', 'protocol-error'].includes(result.status)
    )
      process.exitCode = 1
    console.log(`${differences.length} differences`)
  } else throw new Error('Unknown command or missing arguments')
}
