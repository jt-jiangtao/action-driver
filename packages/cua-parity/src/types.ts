export type FileRecord =
  | { path: string; kind: 'file'; sha256: string; bytes: number; mode: number }
  | { path: string; kind: 'symlink'; target: string }
  | { path: string; kind: 'directory' }
export interface Baseline {
  schemaVersion: 1
  packages: Record<string, { version: string | null; entry: string }>
  files: FileRecord[]
}
export interface Drift {
  path: string
  reason: 'added' | 'removed' | 'changed'
}
export interface InventoryItem {
  path: string
  classification: 'first-party' | 'third-party' | 'resource' | 'unknown'
  evidence: string[]
  imports: string[]
  exports: string[]
  duplicateOf: string | null
}
export interface CaseSpec {
  id: string
  scenarioModule: string
  input: unknown
  timeoutMs: number
}
export interface Trace {
  kind: 'call' | 'event' | 'cleanup'
  name: string
  payload: unknown
}
export interface Outcome {
  status: 'returned' | 'threw' | 'timeout' | 'crashed' | 'protocol-error'
  value: unknown
  error: { name: string; message: string; code: string | null } | null
  trace: Trace[]
  stdout: string
  stderr: string
}
export interface Difference {
  path: string
  expected: unknown
  actual: unknown
}
export interface NormalizationRule {
  path: string
  reason: string
}
