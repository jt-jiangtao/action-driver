import { closeSync, fsyncSync, fstatSync, mkdirSync, openSync, readSync, readdirSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseRolloutLine, type RolloutLine } from './model'

export type RolloutReadResult = {
  lines: RolloutLine[]
  /** Absolute byte offset of the end of the readable prefix. */
  validBytes: number
  truncated: boolean
}

/**
 * Appends records to one session rollout. Writes are whole-line and fsynced, so a
 * crash can only ever leave an incomplete final line, never a rewritten history.
 */
export class RolloutWriter {
  private handle: number | null = null

  constructor(readonly filePath: string) {}

  append(line: RolloutLine): void {
    if (this.handle === null) {
      mkdirSync(dirname(this.filePath), { recursive: true })
      this.handle = openSync(this.filePath, 'a')
    }
    writeSync(this.handle, `${JSON.stringify(line)}\n`)
    fsyncSync(this.handle)
  }

  close(): void {
    if (this.handle === null) return
    closeSync(this.handle)
    this.handle = null
  }
}

/**
 * Reads a rollout, keeping only the longest readable prefix. A torn trailing
 * line is dropped; the first invalid record stops the read so ordering can
 * never develop a silent gap.
 */
export function readRollout(filePath: string, byteOffset = 0): RolloutReadResult {
  let buffer: Buffer
  try {
    const handle = openSync(filePath, 'r')
    try {
      const size = fstatSync(handle).size
      const length = Math.max(0, size - byteOffset)
      const chunk = Buffer.allocUnsafe(length)
      if (length > 0) readSync(handle, chunk, 0, length, byteOffset)
      buffer = chunk
    } finally {
      closeSync(handle)
    }
  } catch {
    return { lines: [], validBytes: byteOffset, truncated: false }
  }
  const lines: RolloutLine[] = []
  let validBytes = byteOffset
  let truncated = false
  let segmentStart = 0
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0x0a) continue
    const raw = buffer.subarray(segmentStart, index).toString('utf8')
    segmentStart = index + 1
    const parsed = parseRawLine(raw)
    if (parsed === null) {
      truncated = true
      break
    }
    lines.push(parsed)
    validBytes = byteOffset + segmentStart
  }
  if (segmentStart < buffer.length && !truncated) truncated = true
  return { lines, validBytes, truncated }
}

function parseRawLine(raw: string): RolloutLine | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return null
  }
  return parseRolloutLine(value)
}

/** `sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`, matching the Codex layout. */
export function sessionRolloutPath(rootDirectory: string, sessionId: string, at = new Date()): string {
  const year = String(at.getUTCFullYear())
  const month = String(at.getUTCMonth() + 1).padStart(2, '0')
  const day = String(at.getUTCDate()).padStart(2, '0')
  const stamp = at.toISOString().replace(/[:.]/g, '-').replace('Z', '')
  return join(rootDirectory, 'sessions', year, month, day, `rollout-${stamp}-${sessionId}.jsonl`)
}

/** Finds authoritative session logs without relying on a disposable projection index. */
export function discoverSessionRollouts(rootDirectory: string): Array<{ sessionId: string; path: string }> {
  const found = new Map<string, string>()
  const visit = (directory: string) => {
    let entries
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { visit(path); continue }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const sessionId = readSessionId(path)
      if (sessionId) found.set(sessionId, path)
    }
  }
  visit(join(rootDirectory, 'sessions'))
  return [...found].map(([sessionId, path]) => ({ sessionId, path }))
}

function readSessionId(path: string): string | null {
  let handle: number
  try { handle = openSync(path, 'r') } catch { return null }
  try {
    const bytes = Buffer.alloc(8192)
    const count = readSync(handle, bytes, 0, bytes.length, 0)
    const end = bytes.subarray(0, count).indexOf(0x0a)
    if (end < 0) return null
    const line = parseRawLine(bytes.subarray(0, end).toString('utf8'))
    return line?.t === 'session_meta' ? line.sessionId : null
  } finally { closeSync(handle) }
}
