import { describe, expect, it } from 'vitest'
import { buildCell, scanTopLevelBindings } from '../../resources/js-repl/bindings.mjs'

const names = (code: string): string[] => scanTopLevelBindings(code).map((binding) => binding.name)

describe('top-level binding discovery', () => {
  it('finds the declarations a cell makes at its top level', () => {
    expect(names('const x = 1')).toEqual(['x'])
    expect(names('var a = 1, b = 2')).toEqual(['a', 'b'])
    expect(names('function f() {}\nasync function g() {}')).toEqual(['f', 'g'])
    expect(names('class K { #field = 1; method() { const hidden = 1 } }')).toEqual(['K'])
    expect(names('let value\nvalue = 3')).toEqual(['value'])
  })

  it('reads destructuring patterns', () => {
    expect(names('const { a, b: c, d = 1, ...rest } = state')).toEqual(['a', 'c', 'd', 'rest'])
    expect(names('let [first, , third = 2, ...others] = list'))
      .toEqual(['first', 'third', 'others'])
  })

  it('ignores nested scopes, strings, templates, comments and regular expressions', () => {
    expect(names('for (const item of list) { const inner = item }')).toEqual([])
    expect(names('if (a) { const block = 1 }')).toEqual([])
    expect(names('const re = /const x = 1/g')).toEqual(['re'])
    expect(names('const text = "const y = 2"')).toEqual(['text'])
    expect(names('const tpl = `const z = ${1}`')).toEqual(['tpl'])
    expect(names('// const commented = 1\nconst real = 2')).toEqual(['real'])
    expect(names('const obj = { const: 1, run() { return 2 } }')).toEqual(['obj'])
  })

  it('keeps whole initializer expressions inside their declaration', () => {
    expect(names('const a = foo(\n  bar,\n  baz\n)\nconst b = 2')).toEqual(['a', 'b'])
    expect(names('const a = 1\nconst b = a + 1')).toEqual(['a', 'b'])
  })
})

describe('cell source assembly', () => {
  /** Stands in for the engine: it only accepts sources whose export list exists. */
  const compile = (source: string): void => {
    const exported = /export \{ ([^}]*)\}/.exec(source)
    if (!exported) return
    const declared = new Set(scanTopLevelBindings(source).map((binding) => binding.name))
    for (const name of exported[1]!.split(',').map((part) => part.trim()).filter(Boolean)) {
      if (!declared.has(name)) throw new SyntaxError(`Export '${name}' is not defined in module`)
    }
  }

  it('carries the previous bindings that the cell does not redeclare', () => {
    const built = buildCell({
      code: 'nodeRepl.write(String(app))',
      priorBindings: [{ name: 'app', kind: 'lexical' }],
      compile
    })
    expect(built.source).toContain('import * as __prev from "@prev";')
    expect(built.source).toContain('let app = __prev.app;')
    expect(built.source).toContain('export { app };')
  })

  it('lets a cell redeclare a carried name without a prelude conflict', () => {
    const built = buildCell({
      code: 'const app = "TextEdit"',
      priorBindings: [{ name: 'app', kind: 'lexical' }],
      compile
    })
    expect(built.source).not.toContain('__prev.app')
    expect(built.source).toContain('export { app };')
    expect(built.bindings).toEqual([{ name: 'app', kind: 'lexical' }])
  })

  it('merges previous and current bindings for the next cell', () => {
    const built = buildCell({
      code: 'const second = 2',
      priorBindings: [{ name: 'first', kind: 'lexical' }],
      compile
    })
    expect(built.source).toContain('let first = __prev.first;')
    expect(built.source).toContain('export { first, second };')
    expect(built.bindings.map((binding) => binding.name)).toEqual(['first', 'second'])
  })

  it('stops carrying a name the engine reports as exported but undefined', () => {
    let rounds = 0
    const built = buildCell({
      code: 'const fresh = 1',
      priorBindings: [],
      // The scanner "finds" a name the cell never declares: the engine rejects the export and the
      // retry drops it instead of failing the call.
      scan: () => [{ name: 'ghost', kind: 'lexical' }],
      compile: (source) => {
        rounds += 1
        if (source.includes('ghost')) {
          throw new SyntaxError("Export 'ghost' is not defined in module")
        }
      }
    })
    expect(rounds).toBeGreaterThan(0)
    expect(built.bindings).toEqual([])
    expect(built.source).toContain('const fresh = 1')
  })

  it('keeps the cell running when a carried name turns out to be declared by the cell', () => {
    let attempts = 0
    const built = buildCell({
      code: 'const carried = 1',
      // The scanner missed the declaration, so the first assembly carries the name and the engine
      // reports the clash; the retry drops it from the prelude and keeps it as this cell's binding.
      priorBindings: [{ name: 'carried', kind: 'lexical' }],
      scan: () => [],
      compile: (source) => {
        attempts += 1
        if (source.includes('let carried = __prev.carried;')) {
          throw new SyntaxError("Identifier 'carried' has already been declared")
        }
      }
    })
    expect(attempts).toBeGreaterThan(1)
    expect(built.source).not.toContain('__prev.carried')
    expect(built.bindings).toEqual([{ name: 'carried', kind: 'lexical' }])
  })
})
