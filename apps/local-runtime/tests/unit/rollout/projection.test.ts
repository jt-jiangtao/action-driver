import { afterEach, describe, expect, it } from 'vitest'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RolloutLine } from '../../../src/rollout/model'
import { RolloutProjection } from '../../../src/rollout/projection'

const temporaryDirectories: string[] = []

function workspace(): {
  root: string
  rolloutPath: string
  statePath: string
  historyPath: string
} {
  const root = mkdtempSync(join(tmpdir(), 'action-driver-projection-'))
  temporaryDirectories.push(root)
  return {
    root,
    rolloutPath: join(root, 'rollout.jsonl'),
    statePath: join(root, 'state.sqlite'),
    historyPath: join(root, 'history.sqlite')
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function writeLines(path: string, lines: RolloutLine[]): void {
  writeFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(''))
}

function appendLines(path: string, lines: RolloutLine[]): void {
  appendFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(''))
}

const sessionMeta: RolloutLine = {
  t: 'session_meta',
  seq: 0,
  ts: '2026-09-30T00:00:00.000Z',
  sessionId: 'session-1',
  threadId: 'session-1',
  model: { connectionId: 'conn', modelId: 'model' },
  originator: 'action-driver-desktop',
  version: '0.1.0'
}

const turnBegin: RolloutLine = {
  t: 'turn_begin',
  seq: 1,
  ts: '2026-09-30T00:00:01.000Z',
  turnId: 'turn-1',
  taskId: 'turn-1',
  goal: '生成图片并压缩'
}

const batch: RolloutLine = {
  t: 'block',
  seq: 2,
  ts: '2026-09-30T00:00:02.000Z',
  turnId: 'turn-1',
  blockId: 'batch-1',
  kind: 'image_batch',
  order: 1,
  slots: 3,
  status: 'pending',
  callId: 'call-1',
  imageCount: 2
}

describe('rollout projection', () => {
  it('filters archived titles before paging and keeps pinned sessions first', () => {
    const paths = workspace()
    const projection = RolloutProjection.open(paths)
    for (const [id, title, timestamp, pinned, archived] of [
      ['a', 'ordinary', '2026-09-30T00:00:03.000Z', false, false],
      ['b', 'matching older', '2026-09-30T00:00:02.000Z', false, true],
      ['c', 'matching newer', '2026-09-30T00:00:04.000Z', false, true],
      ['d', 'pinned', '2026-09-30T00:00:01.000Z', true, false]
    ] as const) {
      const path = join(paths.root, `${id}.jsonl`)
      writeLines(path, [
        { ...sessionMeta, sessionId: id, threadId: id },
        { ...turnBegin, goal: title, ts: timestamp },
        {
          t: 'session_state',
          seq: 2,
          ts: timestamp,
          pinned,
          archived,
          archivedAt: archived ? timestamp : null
        }
      ])
      projection.project({ sessionId: id, path })
    }
    expect(
      projection.queryThreads({ archived: false, limit: 10 }).items.map((item) => item.sessionId)
    ).toEqual(['d', 'a'])
    const first = projection.queryThreads({ archived: true, query: 'MATCHING', limit: 1 })
    expect(first.items.map((item) => item.sessionId)).toEqual(['c'])
    expect(
      projection
        .queryThreads({ archived: true, query: 'matching', limit: 1, cursor: first.nextCursor })
        .items.map((item) => item.sessionId)
    ).toEqual(['b'])
    expect(() => projection.queryThreads({ archived: true, limit: 1, cursor: 'broken' })).toThrow(
      'Invalid session catalog cursor'
    )
    projection.close()
  })

  it('rebuilds session organization metadata from the log', () => {
    const { rolloutPath, statePath, historyPath } = workspace()
    const archivedAt = '2026-09-30T00:00:03.000Z'
    writeLines(rolloutPath, [
      sessionMeta,
      turnBegin,
      {
        t: 'session_state',
        seq: 2,
        ts: archivedAt,
        pinned: true,
        archived: true,
        archivedAt
      } as RolloutLine
    ])
    const projection = RolloutProjection.open({ statePath, historyPath })
    projection.project({ sessionId: 'session-1', path: rolloutPath })
    expect(projection.getThread('session-1')).toMatchObject({
      pinned: true,
      archived: true,
      archivedAt
    })
    projection.rebuild({ sessionId: 'session-1', path: rolloutPath })
    expect(projection.getThread('session-1')).toMatchObject({
      pinned: true,
      archived: true,
      archivedAt
    })
    projection.close()
  })

  it('projects threads, turns and items, then resumes incrementally without duplicates', () => {
    const { rolloutPath, statePath, historyPath } = workspace()
    writeLines(rolloutPath, [sessionMeta, turnBegin, batch])
    const projection = RolloutProjection.open({ statePath, historyPath })
    projection.project({ sessionId: 'session-1', path: rolloutPath })

    expect(projection.getThread('session-1')?.title).toBe('生成图片并压缩')
    expect(projection.listTurns('session-1')).toHaveLength(1)
    expect(projection.readTurnItems('turn-1').map((item) => item.itemId)).toEqual(['batch-1'])

    // Re-projecting the same records must not duplicate rows.
    projection.project({ sessionId: 'session-1', path: rolloutPath })
    expect(projection.readTurnItems('turn-1')).toHaveLength(1)

    appendLines(rolloutPath, [
      {
        t: 'tool',
        seq: 3,
        ts: '2026-09-30T00:00:03.000Z',
        turnId: 'turn-1',
        blockId: 'group-2',
        callId: 'call-2',
        itemIndex: 0,
        toolId: 'sandbox.shell.run',
        modelName: 'shell_run',
        status: 'proposed'
      }
    ])
    projection.project({ sessionId: 'session-1', path: rolloutPath })
    const items = projection.readTurnItems('turn-1')
    expect(items.map((item) => item.itemId)).toEqual(['batch-1', 'tool:call-2'])
    projection.close()
  })

  it('rebuilds a dropped projection from the log alone', () => {
    const { rolloutPath, statePath, historyPath } = workspace()
    writeLines(rolloutPath, [sessionMeta, turnBegin, batch])
    const projection = RolloutProjection.open({ statePath, historyPath })
    projection.project({ sessionId: 'session-1', path: rolloutPath })
    const before = projection.readTurnItems('turn-1')

    projection.rebuild({ sessionId: 'session-1', path: rolloutPath })
    const after = projection.readTurnItems('turn-1')
    expect(after).toEqual(before)
    expect(projection.listThreads(10).map((thread) => thread.sessionId)).toEqual(['session-1'])
    projection.close()
  })

  it('keeps the reserved slot position stable when a late block arrives', () => {
    const { rolloutPath, statePath, historyPath } = workspace()
    writeLines(rolloutPath, [sessionMeta, turnBegin, batch])
    const projection = RolloutProjection.open({ statePath, historyPath })
    projection.project({ sessionId: 'session-1', path: rolloutPath })

    appendLines(rolloutPath, [
      {
        t: 'block',
        seq: 3,
        ts: '2026-09-30T00:00:03.000Z',
        turnId: 'turn-1',
        blockId: 'group-1',
        kind: 'tool_group',
        order: 4,
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
        order: 2,
        slots: 1,
        status: 'completed'
      }
    ])
    projection.project({ sessionId: 'session-1', path: rolloutPath })
    const items = projection.readTurnItems('turn-1')
    const orders = items.map((item) => (item.item as { order: number }).order).sort((a, b) => a - b)
    expect(orders).toEqual([1, 2, 4])
    projection.close()
  })
})
