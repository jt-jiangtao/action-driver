import { readFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import ts from 'typescript'
import type { Baseline, InventoryItem } from './types.js'
export async function inventory(root: string, baseline: Baseline): Promise<InventoryItem[]> {
  const dependencies = new Map<string, string>()
  for (const f of baseline.files)
    if (
      f.kind === 'file' &&
      f.path.endsWith('/package.json') &&
      f.path.split('/').includes('node_modules')
    ) {
      const p = JSON.parse(await readFile(join(root, f.path), 'utf8'))
      if (p.name && p.version) dependencies.set(posix.dirname(f.path), `${p.name}@${p.version}`)
    }
  const hashes = new Map<string, string>()
  const items: InventoryItem[] = []
  for (const f of baseline.files) {
    const item: InventoryItem = {
      path: f.path,
      classification: 'resource',
      evidence: [],
      imports: [],
      exports: [],
      duplicateOf: null
    }
    const dep = [...dependencies.keys()]
      .filter((d) => f.path === d || f.path.startsWith(d + '/'))
      .sort((a, b) => b.length - a.length)[0]
    const code = /\.(?:[cm]?js|tsx?)$/.test(f.path)
    if (dep) {
      item.classification = 'third-party'
      item.evidence.push(dependencies.get(dep)!)
    } else if (code) {
      item.classification = /\/oai_js_(?:core|types|cua(?:_repl)?)\/|\/project\/cua\/sky_js\//.test(
        f.path
      )
        ? 'first-party'
        : 'unknown'
      item.evidence.push(
        item.classification === 'first-party'
          ? 'Known self-owned library path'
          : 'Ownership or bundled boundaries require inspection'
      )
    }
    if (f.kind === 'file') {
      const previous = hashes.get(f.sha256)
      if (previous) item.duplicateOf = previous
      else hashes.set(f.sha256, f.path)
      if (code) {
        const source = ts.createSourceFile(
          f.path,
          await readFile(join(root, f.path), 'utf8'),
          ts.ScriptTarget.Latest,
          true
        )
        function visit(node: ts.Node) {
          if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
          )
            item.imports.push(node.moduleSpecifier.text)
          if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const arg = node.arguments[0]
            if (arg && ts.isStringLiteral(arg)) item.imports.push(arg.text)
            else item.evidence.push('Computed dynamic import')
          }
          if (
            ts.isExportDeclaration(node) &&
            node.exportClause &&
            ts.isNamedExports(node.exportClause)
          )
            for (const e of node.exportClause.elements) item.exports.push(e.name.text)
          if (
            ts.canHaveModifiers(node) &&
            ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
          ) {
            if (ts.isVariableStatement(node))
              for (const d of node.declarationList.declarations)
                if (ts.isIdentifier(d.name)) item.exports.push(d.name.text)
                else item.evidence.push('Destructured export requires inspection')
            if (
              (ts.isFunctionDeclaration(node) ||
                ts.isClassDeclaration(node) ||
                ts.isInterfaceDeclaration(node) ||
                ts.isTypeAliasDeclaration(node)) &&
              node.name
            )
              item.exports.push(node.name.text)
          }
          ts.forEachChild(node, visit)
        }
        visit(source)
      }
    }
    items.push(item)
  }
  return items
}
