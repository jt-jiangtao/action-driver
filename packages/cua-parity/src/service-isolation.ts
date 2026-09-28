import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

export type IsolationReason =
  | 'codex-app-path'
  | 'codex-home-path'
  | 'original-bundle-import'
  | 'private-auth-broker'
  | 'private-native-pipe'
  | 'private-node-repl-global'
  | 'private-node-repl-rpc'
  | 'private-turn-metadata'

export interface IsolationFinding {
  path: string
  reason: IsolationReason
}

const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.py'])
const omitted = [
  `${sep}packages${sep}back${sep}`,
  `${sep}analysis${sep}codex-cua${sep}readable${sep}`,
  `${sep}vendor${sep}codex-cua${sep}`,
  `${sep}node_modules${sep}`
]

const signatures: ReadonlyArray<[IsolationReason, RegExp]> = [
  ['private-node-repl-rpc', /\bnodeRepl\s*\.\s*(?:rpc|call|launchServices)\s*\(/u],
  ['private-native-pipe', /\bnativePipe\s*(?:\?\.)?\s*\.\s*createConnection\s*\(|\bnativePipe\s*\[\s*['"]createConnection['"]\s*\]/u],
  ['private-turn-metadata', /\bnodeRepl\s*\.\s*requestMeta\b|\b(?:codexTurnId|turnMetadata|CODEX_TURN_ID)\b/u],
  ['private-node-repl-global', /\.\s*nodeRepl\b|\bnodeRepl\s*(?:\?\.)?\s*\.\s*[A-Za-z_$][\w$]*/u],
  ['private-auth-broker', /\b(?:connectAuthBroker|authBrokerPipePath|CODEX_AUTH_BROKER)\b/u],
  ['codex-app-path', /(?:\/Applications\/Codex\.app\b|\/Contents\/Resources\/cua_node\b)/u],
  ['codex-home-path', /\b(?:process\.env\.|env\.|env\?\.|\[\s*['"])CODEX_HOME\b/u],
  ['original-bundle-import', /(?:packages\/back\/|vendor\/codex-cua\/|@oai\/(?:browser-desktop|cua-repl|cua|sky)\b)/u]
]

function omittedPath(path: string): boolean {
  return omitted.some((segment) => `${path}${sep}`.includes(segment))
}

async function visit(path: string, findings: IsolationFinding[]): Promise<void> {
  if (omittedPath(path)) return
  const info = await stat(path)
  if (info.isDirectory()) {
    for (const entry of (await readdir(path)).sort()) await visit(resolve(path, entry), findings)
    return
  }
  if (!info.isFile() || !sourceExtensions.has(extname(path))) return
  const source = await readFile(path, 'utf8')
  const finding = signatures.find(([, expression]) => expression.test(source))
  if (finding) findings.push({ path, reason: finding[0] })
}

/**
 * Static audit of candidate source, emitted JavaScript and executable acceptance scripts.
 * Findings are evidence for migration work; they are not a runtime sandbox.
 */
export async function auditServiceIsolation(paths: string[]): Promise<IsolationFinding[]> {
  const findings: IsolationFinding[] = []
  for (const path of paths) await visit(resolve(path), findings)
  return findings.sort((a, b) => a.path.localeCompare(b.path) || a.reason.localeCompare(b.reason))
}
