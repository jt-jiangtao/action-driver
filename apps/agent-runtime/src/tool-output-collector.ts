import type { ToolExecutorEvent } from '@actiondriver/runtime-contracts'

export type CollectedToolOutput = {
  stdout: string
  stderr: string
  content: string
  result: unknown | null
  byteLength: number
  truncated: boolean
}

export class ToolOutputLimitError extends Error {
  readonly code = 'SANDBOX_OUTPUT_LIMIT'

  constructor(readonly output: CollectedToolOutput) {
    super('Tool output exceeded the configured byte limit')
    this.name = 'ToolOutputLimitError'
  }
}

export class ToolOutputCollector {
  private readonly chunks = { stdout: '', stderr: '', result: '' }
  private result: unknown | null = null
  private byteLength = 0
  private truncated = false

  constructor(private readonly maxBytes: number) {}

  add(event: ToolExecutorEvent): void {
    if (event.kind === 'result') {
      const serialized = JSON.stringify(event.output)
      const bytes = Buffer.byteLength(serialized, 'utf8')
      if (this.byteLength + bytes > this.maxBytes) {
        this.truncated = true
        throw new ToolOutputLimitError(this.snapshot())
      }
      this.result = structuredClone(event.output)
      this.byteLength += bytes
      return
    }
    const bytes = Buffer.byteLength(event.delta, 'utf8')
    const remaining = this.maxBytes - this.byteLength
    if (bytes > remaining) {
      if (remaining > 0) {
        let prefix = ''
        let prefixBytes = 0
        for (const character of event.delta) {
          const bytes = Buffer.byteLength(character, 'utf8')
          if (prefixBytes + bytes > remaining) break
          prefix += character
          prefixBytes += bytes
        }
        this.chunks[event.stream] += prefix
        this.byteLength += prefixBytes
      }
      this.truncated = true
      throw new ToolOutputLimitError(this.snapshot())
    }
    this.chunks[event.stream] += event.delta
    this.byteLength += bytes
  }

  snapshot(): CollectedToolOutput {
    return {
      stdout: this.chunks.stdout,
      stderr: this.chunks.stderr,
      content: this.chunks.result,
      result: structuredClone(this.result),
      byteLength: this.byteLength,
      truncated: this.truncated
    }
  }
}
