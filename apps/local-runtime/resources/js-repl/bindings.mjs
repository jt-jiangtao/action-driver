// Top-level binding discovery and cell source assembly for the JavaScript entry.
//
// Every cell runs as its own ES module, so `const`/`let`/`class` can be redeclared on the next call
// without a SyntaxError. Carrying values forward therefore needs the previous cell's binding list:
// names that survive are re-declared from the `@prev` module, and the merged set is exported again
// for the following cell. Discovery runs on a hand written tokenizer, and every assembled source is
// validated by the engine before it runs, so a wrong guess degrades into "this name is not carried"
// instead of running different code.

const PUNCTUATORS = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '**', '<<', '>>',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/', '%',
  '&', '|', '^', '!', '~', '?', ':', '=', '.', '@'
].sort((left, right) => right.length - left.length)

/** Keywords after which a `/` starts a regular expression instead of a division. */
const REGEX_PREFIX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else',
  'yield', 'await', 'throw'
])

/** Keywords that cannot start an expression, so an initializer ends before them. */
const STATEMENT_KEYWORDS = new Set([
  'const', 'let', 'var', 'class', 'function', 'import', 'export', 'if', 'for', 'while', 'do',
  'switch', 'try', 'throw', 'return', 'case', 'default', 'break', 'continue', 'debugger', 'with'
])

const DECLARATION_KEYWORDS = new Set(['const', 'let', 'var'])

const isIdentifierStart = (char) => /[A-Za-z_$]/.test(char) || char.charCodeAt(0) > 127
const isIdentifierPart = (char) => /[A-Za-z0-9_$]/.test(char) || char.charCodeAt(0) > 127
const isDigit = (char) => char >= '0' && char <= '9'
const isWhitespace = (char) =>
  char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f' ||
  char === '\v' || char === '\u00a0' || char === '\ufeff' || char === '\u2028' || char === '\u2029'

/**
 * Splits source into word / number / string / template / regex / punct tokens. Comments and
 * whitespace disappear; everything else keeps its original text so replacements stay exact.
 */
export function tokenize(source) {
  const tokens = []
  let index = 0

  const previous = () => tokens[tokens.length - 1]
  const allowsRegex = () => {
    const token = previous()
    if (!token) return true
    if (token.type === 'word') return REGEX_PREFIX_KEYWORDS.has(token.value)
    if (token.type === 'punct') {
      return token.value !== ')' && token.value !== ']' && token.value !== '}' &&
        token.value !== '++' && token.value !== '--'
    }
    return false
  }

  const readString = (quote) => {
    const start = index
    index += 1
    while (index < source.length) {
      const char = source[index]
      if (char === '\\') { index += 2; continue }
      index += 1
      if (char === quote) break
      if (char === '\n') break
    }
    tokens.push({ type: 'string', value: source.slice(start, index), start, end: index })
  }

  const readTemplate = () => {
    const start = index
    index += 1
    while (index < source.length) {
      const char = source[index]
      if (char === '\\') { index += 2; continue }
      if (char === '`') { index += 1; break }
      if (char === '$' && source[index + 1] === '{') {
        index += 2
        let depth = 1
        while (index < source.length && depth > 0) {
          const inner = source[index]
          if (inner === '{') { depth += 1; index += 1; continue }
          if (inner === '}') { depth -= 1; index += 1; continue }
          if (inner === '"' || inner === "'") {
            const quote = inner
            index += 1
            while (index < source.length && source[index] !== quote) {
              if (source[index] === '\\') index += 1
              index += 1
            }
            index += 1
            continue
          }
          if (inner === '`') { readTemplate(); continue }
          index += 1
        }
        continue
      }
      index += 1
    }
    tokens.push({ type: 'template', value: source.slice(start, index), start, end: index })
  }

  const readRegex = () => {
    const start = index
    index += 1
    let inClass = false
    while (index < source.length) {
      const char = source[index]
      if (char === '\\') { index += 2; continue }
      if (char === '[') inClass = true
      else if (char === ']') inClass = false
      else if (char === '/' && !inClass) { index += 1; break }
      else if (char === '\n') break
      index += 1
    }
    while (index < source.length && /[a-z]/i.test(source[index])) index += 1
    tokens.push({ type: 'regex', value: source.slice(start, index), start, end: index })
  }

  const readWord = () => {
    const start = index
    while (index < source.length && isIdentifierPart(source[index])) index += 1
    tokens.push({ type: 'word', value: source.slice(start, index), start, end: index })
  }

  const readNumber = () => {
    const start = index
    while (index < source.length && /[0-9a-fA-FxXoObB._eE]/.test(source[index])) {
      if ((source[index] === '+' || source[index] === '-') &&
          !/[eE]/.test(source[index - 1])) break
      index += 1
    }
    tokens.push({ type: 'number', value: source.slice(start, index), start, end: index })
  }

  while (index < source.length) {
    const char = source[index]
    if (isWhitespace(char)) { index += 1; continue }
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      index = end < 0 ? source.length : end + 2
      continue
    }
    if (char === '/' && allowsRegex()) { readRegex(); continue }
    if (char === '"' || char === "'") { readString(char); continue }
    if (char === '`') { readTemplate(); continue }
    if (isIdentifierStart(char)) { readWord(); continue }
    if (isDigit(char) || (char === '.' && isDigit(source[index + 1] ?? ''))) { readNumber(); continue }
    const punctuator = PUNCTUATORS.find((candidate) => source.startsWith(candidate, index))
    if (punctuator) {
      tokens.push({ type: 'punct', value: punctuator, start: index, end: index + punctuator.length })
      index += punctuator.length
      continue
    }
    index += 1
  }
  return tokens
}

/** True when the token can end an expression, so a following statement keyword means a new line. */
function endsExpression(token) {
  if (!token) return false
  if (token.type === 'word') return !STATEMENT_KEYWORDS.has(token.value) && token.value !== 'return'
  if (token.type === 'number' || token.type === 'string' || token.type === 'template' ||
      token.type === 'regex') return true
  if (token.type === 'punct') return token.value === ')' || token.value === ']' || token.value === '}'
  return false
}

/**
 * Returns every name declared at the top level of the cell, in source order. Nested blocks,
 * function bodies and for-loop heads keep their own scope, so they are ignored.
 */
export function scanTopLevelBindings(source) {
  const tokens = tokenize(source)
  const found = new Map()
  let depth = 0

  const record = (name, kind) => { if (name && !found.has(name)) found.set(name, kind) }

  // Parses one binding target (identifier, object pattern or array pattern).
  const readTarget = (start, kind) => {
    const token = tokens[start]
    if (!token) return start
    if (token.type === 'word') { record(token.value, kind); return start + 1 }
    if (token.value === '{') {
      let cursor = start + 1
      while (cursor < tokens.length && tokens[cursor].value !== '}') {
        const item = tokens[cursor]
        if (item.value === ',') { cursor += 1; continue }
        if (item.value === '...') { cursor = readTarget(cursor + 1, kind); continue }
        if (item.type === 'word' && tokens[cursor + 1]?.value === ':') {
          cursor = readTarget(cursor + 2, kind)
        } else {
          cursor = readTarget(cursor, kind)
        }
        if (tokens[cursor]?.value === '=') cursor = skipExpression(cursor + 1)
      }
      return cursor + 1
    }
    if (token.value === '[') {
      let cursor = start + 1
      while (cursor < tokens.length && tokens[cursor].value !== ']') {
        if (tokens[cursor].value === ',') { cursor += 1; continue }
        if (tokens[cursor].value === '...') { cursor = readTarget(cursor + 1, kind); continue }
        cursor = readTarget(cursor, kind)
        if (tokens[cursor]?.value === '=') cursor = skipExpression(cursor + 1)
      }
      return cursor + 1
    }
    return start + 1
  }

  // Skips an initializer expression: nested brackets stay inside, `,` and `;` end it.
  function skipExpression(start) {
    let nesting = 0
    let cursor = start
    let last = tokens[start - 1]
    while (cursor < tokens.length) {
      const token = tokens[cursor]
      if (token.type === 'punct') {
        if (token.value === '(' || token.value === '[' || token.value === '{') nesting += 1
        else if (token.value === ')' || token.value === ']' || token.value === '}') {
          if (nesting === 0) return cursor
          nesting -= 1
        } else if (nesting === 0 && (token.value === ',' || token.value === ';')) return cursor
      } else if (nesting === 0 && token.type === 'word' && STATEMENT_KEYWORDS.has(token.value) &&
                 endsExpression(last)) {
        // Automatic semicolon insertion ended the previous statement.
        return cursor
      }
      last = token
      cursor += 1
    }
    return cursor
  }

  for (let cursor = 0; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor]
    if (token.type === 'punct') {
      if (token.value === '{' || token.value === '(' || token.value === '[') depth += 1
      else if (token.value === '}' || token.value === ')' || token.value === ']') {
        depth = Math.max(0, depth - 1)
      }
      continue
    }
    if (depth > 0 || token.type !== 'word') continue
    if (DECLARATION_KEYWORDS.has(token.value)) {
      const kind = token.value === 'var' ? 'var' : 'lexical'
      let position = cursor + 1
      for (;;) {
        position = readTarget(position, kind)
        if (tokens[position]?.value === '=') position = skipExpression(position + 1)
        if (tokens[position]?.value === ',') { position += 1; continue }
        break
      }
      cursor = position - 1
      continue
    }
    if (token.value === 'function') {
      const name = tokens[cursor + 1]
      if (name?.type === 'word') record(name.value, 'var')
      continue
    }
    if (token.value === 'async' && tokens[cursor + 1]?.value === 'function') {
      const name = tokens[cursor + 2]
      if (name?.type === 'word') record(name.value, 'var')
      continue
    }
    if (token.value === 'class') {
      const name = tokens[cursor + 1]
      if (name?.type === 'word') record(name.value, 'lexical')
      continue
    }
  }
  return Array.from(found, ([name, kind]) => ({ name, kind }))
}

export function normalizeBindings(bindings) {
  const map = new Map()
  for (const binding of bindings ?? []) {
    if (typeof binding?.name === 'string' && binding.name.length > 0) {
      map.set(binding.name, binding.kind === 'var' ? 'var' : 'lexical')
    }
  }
  return Array.from(map, ([name, kind]) => ({ name, kind }))
}

export function renderCarryPrelude(carried) {
  if (!carried.length) return ''
  const declarations = carried
    .map((binding) => `${binding.kind === 'var' ? 'var' : 'let'} ${binding.name} = __prev.${binding.name};`)
    .join('\n')
  return `import * as __prev from "@prev";\n${declarations}\n`
}

function renderSource(code, carried, exported) {
  const prelude = renderCarryPrelude(carried)
  const exportStatement = exported.length ? `\nexport { ${exported.join(', ')} };\n` : '\n'
  return `${prelude}${code}${exportStatement}`
}

/**
 * Assembles the module source for one cell.
 *
 * `compile(source)` must throw the engine's SyntaxError for invalid sources. Conflicts reported by
 * the engine (a name the scanner treated as carried that the cell declares itself, or an export that
 * does not exist) are resolved by retrying, so the scanner never has to be perfect.
 */
export function buildCell({ code, priorBindings = [], compile, scan = scanTopLevelBindings }) {
  const prior = normalizeBindings(priorBindings)
  const scanned = normalizeBindings(scan(code))
  const currentNames = new Set(scanned.map((binding) => binding.name))
  const carried = prior.filter((binding) => !currentNames.has(binding.name))
  const merged = new Map(prior.map((binding) => [binding.name, binding.kind]))
  for (const binding of scanned) merged.set(binding.name, binding.kind)

  const attempt = () => {
    const exported = Array.from(merged.keys())
    const source = renderSource(code, carried, exported)
    compile(source)
    return { source, bindings: Array.from(merged, ([name, kind]) => ({ name, kind })) }
  }

  for (let round = 0; round < 8; round += 1) {
    let error
    try {
      return attempt()
    } catch (failure) {
      error = failure
    }
    const message = error instanceof Error ? error.message : String(error)
    const redeclared = /Identifier '([^']+)' has already been declared/.exec(message)
    if (redeclared) {
      const name = redeclared[1]
      const position = carried.findIndex((binding) => binding.name === name)
      if (position >= 0) {
        carried.splice(position, 1)
        merged.set(name, merged.get(name) ?? 'var')
        continue
      }
    }
    const missing = /Export '([^']+)' is not defined/.exec(message)
    if (missing) {
      const name = missing[1]
      merged.delete(name)
      const position = carried.findIndex((binding) => binding.name === name)
      if (position >= 0) carried.splice(position, 1)
      continue
    }
    if (/Duplicate export of '([^']+)'/.test(message)) continue
    break
  }

  // Last resort: run the cell unmodified. Bindings from this cell are not carried, but the code the
  // model wrote still executes instead of failing on our instrumentation.
  compile(code)
  return { source: code, bindings: [] }
}
