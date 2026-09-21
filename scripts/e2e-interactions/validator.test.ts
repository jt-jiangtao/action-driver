import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { e2eId } from '../../apps/desktop/src/renderer/src/testing/e2e-id'
import { validateInteractionSources } from './validator.mjs'

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')
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

  it('detects role, contenteditable, disabled and spread-only bypasses', () => {
    const result = validateInteractionSources({ files: [fixture('interaction-kinds.tsx')] })
    expect(result.errors.map((error) => error.code)).toEqual([
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
})
