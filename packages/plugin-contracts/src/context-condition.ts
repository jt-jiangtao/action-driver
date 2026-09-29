export type ContextValue = boolean | string | number
export type ContextSnapshot = Readonly<Record<string, ContextValue>>
type Node = { kind: 'key'; key: string } | { kind: 'equal'; key: string; value: ContextValue } | { kind: 'not'; child: Node } | { kind: 'and' | 'or'; left: Node; right: Node }
export interface ContextCondition { readonly source: string; readonly keys: readonly string[]; readonly expression: Node }
type Token = { value: string; offset: number; kind: 'key' | 'literal' | 'operator' }
const keyPattern = /^(?:host\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*|plugin\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*)$/

export function isContextKey(value: string): boolean { return value.length <= 128 && keyPattern.test(value) }

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let offset = 0
  while (offset < source.length) {
    if (/\s/.test(source[offset]!)) { offset++; continue }
    const rest = source.slice(offset)
    const match = /^(?:&&|\|\||==|[!()]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|-?\d+(?:\.\d+)?|[a-z][a-z0-9.-]*)/.exec(rest)
    if (!match) throw new Error(`Invalid condition token at ${offset}`)
    const value = match[0]!
    const kind = /^(?:&&|\|\||==|[!()])$/.test(value) ? 'operator' : /^(?:["']|-?\d|true$|false$)/.test(value) ? 'literal' : 'key'
    tokens.push({ value, offset, kind })
    offset += value.length
  }
  return tokens
}

function literal(value: string): ContextValue {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value.startsWith('"')) return JSON.parse(value) as string
  if (value.startsWith("'")) return value.slice(1, -1).replace(/\\(['\\])/g, '$1')
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error('Invalid numeric condition literal')
  return number
}

export function parseContextCondition(source: string): ContextCondition {
  if (!source.trim() || source.length > 1024) throw new Error('Condition length must be 1..1024')
  const tokens = tokenize(source)
  let index = 0
  const keys = new Set<string>()
  const take = (value: string) => tokens[index]?.value === value ? (index++, true) : false
  const expression = (depth: number): Node => {
    if (depth > 32) throw new Error('Condition nesting exceeds 32')
    const unary = (level: number): Node => {
      if (level > 32) throw new Error('Condition nesting exceeds 32')
      if (take('!')) return { kind: 'not', child: unary(level + 1) }
      if (take('(')) {
        const node = expression(level + 1)
        if (!take(')')) throw new Error(`Expected ) at ${tokens[index]?.offset ?? source.length}`)
        return node
      }
      const token = tokens[index++]
      if (!token || token.kind !== 'key' || !isContextKey(token.value)) throw new Error(`Expected context key at ${token?.offset ?? source.length}`)
      keys.add(token.value)
      if (keys.size > 64) throw new Error('Condition references more than 64 keys')
      if (!take('==')) return { kind: 'key', key: token.value }
      const next = tokens[index++]
      if (!next || next.kind !== 'literal') throw new Error(`Expected literal at ${next?.offset ?? source.length}`)
      return { kind: 'equal', key: token.value, value: literal(next.value) }
    }
    const conjunction = (): Node => {
      let node = unary(depth)
      while (take('&&')) node = { kind: 'and', left: node, right: unary(depth) }
      return node
    }
    let node = conjunction()
    while (take('||')) node = { kind: 'or', left: node, right: conjunction() }
    return node
  }
  const ast = expression(0)
  if (index !== tokens.length) throw new Error(`Unexpected token at ${tokens[index]?.offset}`)
  return { source, keys: [...keys], expression: ast }
}

export function evaluateContextCondition(condition: ContextCondition, snapshot: ContextSnapshot): boolean {
  if (condition.keys.some(key => !Object.hasOwn(snapshot, key))) return false
  const evaluate = (node: Node): boolean => {
    switch (node.kind) {
      case 'key': return snapshot[node.key] === true
      case 'equal': return snapshot[node.key] === node.value
      case 'not': return !evaluate(node.child)
      case 'and': return evaluate(node.left) && evaluate(node.right)
      case 'or': return evaluate(node.left) || evaluate(node.right)
    }
  }
  return evaluate(condition.expression)
}
