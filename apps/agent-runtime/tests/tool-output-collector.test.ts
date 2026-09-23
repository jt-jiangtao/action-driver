import { describe, expect, it } from 'vitest'
import { ToolOutputCollector, ToolOutputLimitError } from '../src/tool-output-collector'

describe('ToolOutputCollector', () => {
  it('keeps stdout and stderr ordered and truncates only at UTF-8 boundaries', () => {
    const collector = new ToolOutputCollector(5)
    collector.add({ kind: 'content', stream: 'stdout', delta: 'ab' })
    expect(() => collector.add({ kind: 'content', stream: 'stderr', delta: '你c' })).toThrow(
      ToolOutputLimitError
    )
    expect(collector.snapshot()).toMatchObject({
      stdout: 'ab',
      stderr: '你',
      byteLength: 5,
      truncated: true
    })
  })

  it('counts structured result bytes against the same limit', () => {
    const collector = new ToolOutputCollector(5)
    expect(() => collector.add({ kind: 'result', output: { value: 'long' } })).toThrow(
      ToolOutputLimitError
    )
    expect(collector.snapshot()).toMatchObject({ result: null, truncated: true })
  })
})
