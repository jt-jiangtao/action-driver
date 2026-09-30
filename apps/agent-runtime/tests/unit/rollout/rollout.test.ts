import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRolloutLine, type RolloutLine } from '../../../src/rollout/model'
import { RolloutWriter, readRollout, sessionRolloutPath } from '../../../src/rollout/log'
import {
  applyRolloutLine,
  emptyRolloutState,
  foldRollout,
  nextOrder,
  toolsInOrder
} from '../../../src/rollout/fold'

const temporaryDirectories: string[] = []

function temporaryFile(name = 'rollout.jsonl'): string {
  const directory = mkdtempSync(join(tmpdir(), 'action-driver-rollout-'))
  temporaryDirectories.push(directory)
  return join(directory, name)
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const meta = (seq: number): RolloutLine => ({
  t: 'session_meta',
  seq,
  ts: '2026-09-30T00:00:00.000Z',
  sessionId: 'session-1',
  threadId: 'session-1',
  model: { connectionId: 'c', modelId: 'm' },
  originator: 'action-driver-desktop',
  version: '0.1.0'
})

const turnBegin = (seq: number): RolloutLine => ({
  t: 'turn_begin',
  seq,
  ts: '2026-09-30T00:00:01.000Z',
  turnId: 'turn-1',
  taskId: 'turn-1',
  goal: '生成图片并压缩'
})

describe('rollout line model', () => {
  it('parses every record type and rejects malformed records', () => {
    expect(parseRolloutLine(meta(0))?.t).toBe('session_meta')
    expect(parseRolloutLine(turnBegin(1))?.t).toBe('turn_begin')
    expect(
      parseRolloutLine({
        t: 'block',
        seq: 2,
        ts: '2026-09-30T00:00:02.000Z',
        turnId: 'turn-1',
        blockId: 'b1',
        kind: 'image_batch',
        order: 2,
        slots: 3,
        status: 'pending',
        callId: 'call-1',
        imageCount: 2
      })?.t
    ).toBe('block')
    expect(parseRolloutLine({ t: 'block', seq: 1 })).toBeNull()
    expect(parseRolloutLine({ t: 'unknown', seq: 1 })).toBeNull()
    expect(parseRolloutLine('not json')).toBeNull()
  })

  it('rejects a block whose status is outside the union', () => {
    expect(
      parseRolloutLine({
        t: 'block',
        seq: 1,
        ts: '2026-09-30T00:00:00.000Z',
        turnId: 'turn-1',
        blockId: 'b1',
        kind: 'text',
        order: 1,
        slots: 1,
        status: 'done'
      })
    ).toBeNull()
  })
})

describe('rollout log', () => {
  it('appends whole lines and never rewrites earlier bytes', () => {
    const file = temporaryFile()
    const writer = new RolloutWriter(file)
    writer.append(meta(0))
    const afterFirst = readFileSync(file)
    writer.append(turnBegin(1))
    const afterSecond = readFileSync(file)
    expect(afterSecond.subarray(0, afterFirst.length).equals(afterFirst)).toBe(true)
    writer.close()

    const result = readRollout(file)
    expect(result.lines.map((line) => line.t)).toEqual(['session_meta', 'turn_begin'])
    expect(result.truncated).toBe(false)
  })

  it('drops a torn trailing line and stops at the first invalid record', () => {
    const file = temporaryFile()
    writeFileSync(
      file,
      `${JSON.stringify(meta(0))}\n${JSON.stringify(turnBegin(1))}\n{"t":"block","seq":2`
    )
    const torn = readRollout(file)
    expect(torn.lines).toHaveLength(2)
    expect(torn.truncated).toBe(true)
    expect(torn.validBytes).toBe(Buffer.byteLength(`${JSON.stringify(meta(0))}\n${JSON.stringify(turnBegin(1))}\n`))

    appendFileSync(file, '\n{"t":"bogus"}\n')
    const invalid = readRollout(file)
    expect(invalid.lines).toHaveLength(2)
  })

  it('derives a Codex-shaped session path', () => {
    const path = sessionRolloutPath('/root', 'session-1', new Date('2026-09-30T04:05:06.000Z'))
    expect(path).toBe('/root/sessions/2026/09/30/rollout-2026-09-30T04-05-06-000-session-1.jsonl')
  })
})

describe('rollout fold', () => {
  it('produces the same state for a full fold and incremental application', () => {
    const lines: RolloutLine[] = [
      meta(0),
      turnBegin(1),
      {
        t: 'block',
        seq: 2,
        ts: '2026-09-30T00:00:02.000Z',
        turnId: 'turn-1',
        blockId: 'text-1',
        kind: 'text',
        order: 1,
        slots: 1,
        status: 'streaming',
        delta: '先看看依赖',
        phase: 'process'
      },
      {
        t: 'block',
        seq: 3,
        ts: '2026-09-30T00:00:03.000Z',
        turnId: 'turn-1',
        blockId: 'group-1',
        kind: 'tool_group',
        order: 2,
        slots: 1,
        status: 'pending',
        title: '生成图片',
        titleRevision: 1
      },
      {
        t: 'tool',
        seq: 4,
        ts: '2026-09-30T00:00:04.000Z',
        turnId: 'turn-1',
        blockId: 'group-1',
        callId: 'call-1',
        itemIndex: 0,
        toolId: 'tools/local/image-generation/generate',
        modelName: 'image_generate',
        status: 'proposed'
      },
      {
        t: 'tool',
        seq: 5,
        ts: '2026-09-30T00:00:05.000Z',
        turnId: 'turn-1',
        blockId: 'group-1',
        callId: 'call-1',
        itemIndex: 0,
        toolId: 'tools/local/image-generation/generate',
        modelName: 'image_generate',
        status: 'completed',
        durationMs: 1200
      },
      {
        t: 'turn_end',
        seq: 6,
        ts: '2026-09-30T00:00:06.000Z',
        turnId: 'turn-1',
        status: 'completed',
        durationMs: 6000,
        content: '完成'
      }
    ]
    const full = foldRollout(lines)
    const incremental = lines.reduce(applyRolloutLine, emptyRolloutState())
    expect(JSON.stringify(snapshot(full))).toBe(JSON.stringify(snapshot(incremental)))
    expect(full.turns[0]?.status).toBe('completed')
    expect(full.turns[0]?.finalContent).toBe('完成')
  })

  it('keeps only the last tool status after appended updates', () => {
    const state = foldRollout([
      meta(0),
      turnBegin(1),
      {
        t: 'tool',
        seq: 2,
        ts: '2026-09-30T00:00:02.000Z',
        turnId: 'turn-1',
        blockId: 'group-1',
        callId: 'call-1',
        itemIndex: 0,
        toolId: 'sandbox.shell.run',
        modelName: 'shell_run',
        status: 'proposed',
        summary: '执行命令'
      },
      {
        t: 'tool',
        seq: 3,
        ts: '2026-09-30T00:00:03.000Z',
        turnId: 'turn-1',
        blockId: 'group-1',
        callId: 'call-1',
        itemIndex: 0,
        toolId: 'sandbox.shell.run',
        modelName: 'shell_run',
        status: 'failed',
        errorSummary: '命令失败'
      }
    ])
    const tool = toolsInOrder(state.turns[0]!)[0]!
    expect(tool.status).toBe('failed')
    expect(tool.summary).toBe('执行命令')
    expect(tool.errorSummary).toBe('命令失败')
  })

  it('concatenates text increments in seq order', () => {
    const state = foldRollout([
      meta(0),
      turnBegin(1),
      {
        t: 'block',
        seq: 2,
        ts: '2026-09-30T00:00:02.000Z',
        turnId: 'turn-1',
        blockId: 'text-1',
        kind: 'text',
        order: 1,
        slots: 1,
        status: 'streaming',
        delta: '先看看',
        phase: 'process'
      },
      {
        t: 'block',
        seq: 3,
        ts: '2026-09-30T00:00:03.000Z',
        turnId: 'turn-1',
        blockId: 'text-1',
        kind: 'text',
        order: 1,
        slots: 1,
        status: 'completed',
        delta: '现有依赖',
        phase: 'process'
      }
    ])
    expect(state.turns[0]?.blocks[0]?.text).toBe('先看看现有依赖')
  })
})

describe('rollout order allocation', () => {
  it('keeps reserved image slots and starts new blocks after them', () => {
    const blocks = [
      { order: 1, slots: 1 },
      { order: 2, slots: 3 },
      { order: 3, slots: 1 },
      { order: 4, slots: 1 }
    ]
    expect(nextOrder(blocks)).toBe(5)
  })

  it('does not reuse a reserved slot when an image arrives late', () => {
    const lines: RolloutLine[] = [
      meta(0),
      turnBegin(1),
      {
        t: 'block',
        seq: 2,
        ts: '2026-09-30T00:00:02.000Z',
        turnId: 'turn-1',
        blockId: 'batch',
        kind: 'image_batch',
        order: 2,
        slots: 3,
        status: 'pending',
        callId: 'call-1',
        imageCount: 2
      },
      {
        t: 'block',
        seq: 3,
        ts: '2026-09-30T00:00:03.000Z',
        turnId: 'turn-1',
        blockId: 'next-group',
        kind: 'tool_group',
        order: 5,
        slots: 1,
        status: 'pending'
      },
      {
        t: 'block',
        seq: 4,
        ts: '2026-09-30T00:00:04.000Z',
        turnId: 'turn-1',
        blockId: 'image-0',
        kind: 'image',
        order: 3,
        slots: 1,
        status: 'completed'
      }
    ]
    const turn = foldRollout(lines).turns[0]!
    expect(turn.blocks.map((block) => block.order)).toEqual([2, 3, 5])
  })
})

function snapshot(state: ReturnType<typeof foldRollout>): unknown {
  return {
    sessionId: state.sessionId,
    cursor: state.cursor,
    turns: state.turns.map((turn) => ({
      turnId: turn.turnId,
      status: turn.status,
      finalContent: turn.finalContent,
      blocks: turn.blocks,
      tools: [...turn.tools.values()]
    }))
  }
}
