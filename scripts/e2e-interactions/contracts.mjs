import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { E2E_TEST_ID_PATTERN } from './config.mjs'

const error = (code, message) => ({
  file: 'apps/desktop/tests/e2e/interaction-contracts.json',
  line: 1,
  column: 1,
  code,
  message
})

export function loadInteractionContracts(file) {
  const value = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(value)) throw new Error('Interaction contract manifest must be an array')
  return value
}

export function validateContracts(contracts, { projectRoot = process.cwd(), interactions } = {}) {
  const errors = []
  const targets = new Set()
  const interactionTargets = interactions ? new Set(interactions.map((item) => item.target)) : null

  for (const contract of contracts) {
    if (!contract || typeof contract !== 'object') {
      errors.push(error('invalid-contract', 'Contract entries must be objects'))
      continue
    }

    const { target, route, type, coverage, testFile, testName } = contract
    if (typeof target !== 'string' || !E2E_TEST_ID_PATTERN.test(target)) {
      errors.push(error('invalid-contract-target', `Invalid contract target: ${String(target)}`))
      continue
    }
    if (targets.has(target)) errors.push(error('duplicate-contract', `Duplicate contract: ${target}`))
    targets.add(target)

    const parsedRoute = target.split('/')[1]
    const parsedType = target.slice(target.lastIndexOf('#') + 1)
    if (route !== parsedRoute) {
      errors.push(error('contract-route-mismatch', `${target} declares route ${String(route)}`))
    }
    if (type !== parsedType) {
      errors.push(error('contract-type-mismatch', `${target} declares type ${String(type)}`))
    }
    if (coverage !== 'functional' && coverage !== 'visual-only') {
      errors.push(error('invalid-coverage', `${target} has invalid coverage ${String(coverage)}`))
    }

    if (coverage === 'functional') {
      if (typeof testFile !== 'string' || typeof testName !== 'string') {
        errors.push(error('missing-test-reference', `${target} requires testFile and testName`))
      } else {
        const absoluteTestFile = resolve(projectRoot, testFile)
        if (!existsSync(absoluteTestFile)) {
          errors.push(error('missing-test-file', `${target} references missing ${testFile}`))
        } else if (!readFileSync(absoluteTestFile, 'utf8').includes(testName)) {
          errors.push(error('missing-test-name', `${testFile} does not contain ${testName}`))
        }
      }
    }

    if (interactionTargets && !interactionTargets.has(target)) {
      errors.push(error('stale-contract', `${target} has no matching source interaction`))
    }
  }

  if (interactionTargets) {
    for (const target of interactionTargets) {
      if (!targets.has(target)) errors.push(error('unregistered-interaction', `${target} is not registered`))
    }
  }

  return { errors }
}
