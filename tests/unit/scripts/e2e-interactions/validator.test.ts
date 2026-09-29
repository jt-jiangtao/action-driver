import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { e2eId } from '../../../../apps/desktop/src/renderer/src/testing/e2e-id'
import { validateContracts } from '../../../../scripts/e2e-interactions/contracts.mjs'
import { validateInteractionSources } from '../../../../scripts/e2e-interactions/validator.mjs'

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/e2e-interactions/fixtures')
const fixture = (name: string) => resolve(fixtureRoot, name)

describe('e2eId', () => {
  it('replaces every named parameter with an encoded stable id', () => {
    expect(
      e2eId('e2e/shared/sidebar/tasks/:task-id/models/:model-id#button', {
        'task-id': 'hotel/task',
        'model-id': 'gpt 5'
      })
    ).toBe('e2e/shared/sidebar/tasks/hotel%2Ftask/models/gpt%205#button')
  })

  it('rejects missing and unused parameters', () => {
    expect(() => e2eId('e2e/shared/tasks/:task-id#button', {})).toThrow(/task-id/)
    expect(() => e2eId('e2e/shared/tasks/item#button', { unused: 'x' })).toThrow(/unused/)
  })
})

describe('validateInteractionSources', () => {
  it('reports a clickable button without a test id', () => {
    const result = validateInteractionSources({ files: [fixture('missing-id.tsx')] })
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'missing-test-id', line: 1, column: 1 })
    )
  })

  it('rejects dynamic expressions that do not call e2eId', () => {
    const result = validateInteractionSources({ files: [fixture('invalid-dynamic-id.tsx')] })
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'unapproved-dynamic-id' })
    )
  })

  it('accepts static and approved dynamic ids', () => {
    const result = validateInteractionSources({ files: [fixture('valid.tsx')] })
    expect(result.errors).toEqual([])
    expect(result.interactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'static', target: 'e2e/home/composer/send#button' }),
        expect.objectContaining({
          kind: 'dynamic',
          target: 'e2e/shared/sidebar/tasks/:task-id#button'
        })
      ])
    )
  })

  it('detects role, contenteditable, native click handlers, disabled and spread-only bypasses', () => {
    const result = validateInteractionSources({ files: [fixture('interaction-kinds.tsx')] })
    expect(result.errors.map((error) => error.code)).toEqual([
      'missing-test-id',
      'missing-test-id',
      'missing-test-id',
      'missing-test-id',
      'missing-test-id'
    ])
  })

  it('reports duplicate static ids but ignores ordinary containers', () => {
    const result = validateInteractionSources({ files: [fixture('duplicates.tsx')] })
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'duplicate-test-id' }))
    expect(result.errors).toHaveLength(1)
  })

  it('rejects an interaction missing from the contract manifest', () => {
    const result = validateInteractionSources({
      files: [fixture('unregistered.tsx')],
      contracts: []
    })
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'unregistered-interaction' })
    )
  })

  it('accepts a registered dynamic pattern', () => {
    const result = validateInteractionSources({
      files: [fixture('valid.tsx')],
      contracts: [
        contract('e2e/home/composer/send#button'),
        contract('e2e/shared/sidebar/tasks/:task-id#button')
      ]
    })
    expect(result.errors).toEqual([])
  })
})

const contract = (target: string, overrides: Record<string, unknown> = {}) => {
  const [, route] = target.split('/')
  const type = target.slice(target.lastIndexOf('#') + 1)
  return { target, route, type, coverage: 'visual-only', ...overrides }
}

describe('validateContracts', () => {
  it('requires functional contracts to reference a real named test', () => {
    const result = validateContracts([
      contract('e2e/home/composer/send#button', { coverage: 'functional' })
    ])
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'missing-test-reference' })
    )
  })

  it('rejects duplicate targets and route/type mismatches', () => {
    const entry = contract('e2e/home/composer/send#button')
    const result = validateContracts([entry, entry, { ...entry, target: 'e2e/task/agent/send#button' }])
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['duplicate-contract', 'contract-route-mismatch'])
    )
  })

  it('rejects stale contracts that have no source interaction', () => {
    const result = validateInteractionSources({
      files: [fixture('unregistered.tsx')],
      contracts: [contract('e2e/home/other/action#button')]
    })
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'stale-contract' }))
  })
})

describe('validate-e2e-interactions CLI', () => {
  const cli = resolve(fixtureRoot, '..', '..', 'validate-e2e-interactions.mjs')
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], { cwd: resolve(fixtureRoot, '../../..'), encoding: 'utf8' })

  it('returns zero for valid source and non-zero for each enforced violation', () => {
    expect(run('--files', fixture('valid.tsx'), '--skip-contracts').status).toBe(0)

    for (const name of ['missing-id.tsx', 'invalid-dynamic-id.tsx', 'duplicates.tsx']) {
      const result = run('--files', fixture(name), '--skip-contracts')
      expect(result.status, `${name}: ${result.stderr}`).not.toBe(0)
    }

    const unregistered = run(
      '--files',
      fixture('unregistered.tsx'),
      '--contracts',
      fixture('empty-contracts.json')
    )
    expect(unregistered.status, unregistered.stderr).not.toBe(0)
  })
})
