export type Binding = { name: string; kind: 'lexical' | 'var' }

export function tokenize(source: string): Array<{ type: string; value: string; start: number; end: number }>
export function scanTopLevelBindings(source: string): Binding[]
export function normalizeBindings(bindings: readonly Binding[] | undefined): Binding[]
export function renderCarryPrelude(carried: readonly Binding[]): string
export function buildCell(options: {
  code: string
  priorBindings?: readonly Binding[]
  compile(source: string): void
  scan?(code: string): Binding[]
}): { source: string; bindings: Binding[] }
