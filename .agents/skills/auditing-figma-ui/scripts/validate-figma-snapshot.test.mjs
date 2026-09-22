import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  SnapshotInputError,
  exitCodeForResult,
  formatHumanReport,
  validateSnapshot,
} from './validate-figma-snapshot.mjs'

const scriptPath = new URL('./validate-figma-snapshot.mjs', import.meta.url)

function figmaNode(overrides = {}) {
  return {
    id: 'node',
    name: 'Node',
    type: 'FRAME',
    parentId: null,
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    ...overrides,
  }
}

function validSnapshot(nodes = []) {
  return {
    schemaVersion: 1,
    fileKey: 'PzmxsQ99mfhqedj4aFYut0',
    capturedAt: '2026-09-22T08:00:00.000Z',
    page: { id: '60:2', name: 'Components' },
    nodes,
  }
}

function validConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    pages: [{ id: '60:2', name: 'Components' }],
    exceptions: [],
    ...overrides,
  }
}

test('rejects an unsupported snapshot schema version', () => {
  assert.throws(
    () => validateSnapshot({ ...validSnapshot(), schemaVersion: 2 }, validConfig()),
    (error) => error instanceof SnapshotInputError && /schemaVersion/.test(error.message),
  )
})

test('reports visible clipped text but ignores hidden text', () => {
  const result = validateSnapshot(
    validSnapshot([
      figmaNode({ id: 'parent', type: 'FRAME', width: 80, height: 32, clipsContent: true }),
      figmaNode({
        id: 'visible',
        type: 'TEXT',
        parentId: 'parent',
        x: 12,
        y: 8,
        width: 76,
        height: 16,
        text: '很长的标签',
      }),
      figmaNode({
        id: 'hidden',
        type: 'TEXT',
        parentId: 'parent',
        visible: false,
        x: 0,
        y: 40,
        width: 100,
        height: 16,
        text: '不可见',
      }),
    ]),
    validConfig(),
  )

  assert.deepEqual(
    result.issues.map(({ ruleId, nodeId }) => [ruleId, nodeId]),
    [['TEXT_OUT_OF_BOUNDS', 'visible']],
  )
  assert.deepEqual(result.issues[0].measurements, {
    overflowBottom: 0,
    overflowLeft: 0,
    overflowRight: 8,
    overflowTop: 0,
  })
})

test('propagates hidden visibility from ancestors', () => {
  const result = validateSnapshot(
    validSnapshot([
      figmaNode({ id: 'parent', width: 40, height: 20, clipsContent: true, visible: false }),
      figmaNode({
        id: 'child',
        type: 'TEXT',
        parentId: 'parent',
        x: 30,
        width: 60,
        text: 'hidden by parent',
      }),
    ]),
    validConfig(),
  )

  assert.equal(result.issues.length, 0)
})

test('reports text characters used as interface icons', () => {
  const result = validateSnapshot(
    validSnapshot([
      figmaNode({
        id: 'glyph',
        type: 'TEXT',
        text: '⌄',
        semanticRole: 'icon',
        width: 16,
        height: 16,
      }),
    ]),
    validConfig(),
  )

  assert.deepEqual(result.issues.map(({ ruleId, nodeId }) => [ruleId, nodeId]), [
    ['TEXT_GLYPH_ICON', 'glyph'],
  ])
})

test('reports overlapping variants but not variants that only touch edges', () => {
  const result = validateSnapshot(
    validSnapshot([
      figmaNode({ id: 'set', type: 'COMPONENT_SET', width: 240, height: 80 }),
      figmaNode({ id: 'normal', type: 'COMPONENT', parentId: 'set', width: 80, height: 40 }),
      figmaNode({ id: 'hover', type: 'COMPONENT', parentId: 'set', x: 72, width: 80, height: 40 }),
      figmaNode({ id: 'disabled', type: 'COMPONENT', parentId: 'set', x: 152, width: 80, height: 40 }),
    ]),
    validConfig(),
  )

  assert.deepEqual(result.issues.map(({ ruleId, nodeId }) => [ruleId, nodeId]), [
    ['VARIANT_OVERLAP', 'hover'],
  ])
  assert.deepEqual(result.issues[0].measurements, { overlapHeight: 40, overlapWidth: 8 })
})

test('reports overlapping sections while allowing edge contact', () => {
  const result = validateSnapshot(
    validSnapshot([
      figmaNode({ id: 'section-a', type: 'SECTION', width: 200, height: 100 }),
      figmaNode({ id: 'section-b', type: 'SECTION', x: 190, width: 200, height: 100 }),
      figmaNode({ id: 'section-c', type: 'SECTION', x: 390, width: 200, height: 100 }),
    ]),
    validConfig(),
  )

  assert.deepEqual(result.issues.map(({ ruleId, nodeId }) => [ruleId, nodeId]), [
    ['SECTION_OVERLAP', 'section-b'],
  ])
})

test('suppresses only an exact rule and node exception', () => {
  const snapshot = validSnapshot([
    figmaNode({ id: 'glyph-a', type: 'TEXT', text: '⌄', semanticRole: 'icon' }),
    figmaNode({ id: 'glyph-b', type: 'TEXT', text: '⌄', semanticRole: 'icon', x: 24 }),
  ])
  const result = validateSnapshot(
    snapshot,
    validConfig({
      exceptions: [{ ruleId: 'TEXT_GLYPH_ICON', nodeId: 'glyph-a', reason: 'Legacy export marker' }],
    }),
  )

  assert.deepEqual(result.issues.map(({ ruleId, nodeId }) => [ruleId, nodeId]), [
    ['TEXT_GLYPH_ICON', 'glyph-b'],
  ])
  assert.deepEqual(result.exceptionsApplied, [
    {
      nodeId: 'glyph-a',
      reason: 'Legacy export marker',
      ruleId: 'TEXT_GLYPH_ICON',
    },
  ])
})

test('sorts issues deterministically and formats a readable report', () => {
  const result = validateSnapshot(
    validSnapshot([
      figmaNode({ id: 'z', type: 'TEXT', text: '⌄', semanticRole: 'icon', x: 32 }),
      figmaNode({ id: 'a', type: 'TEXT', text: '⌄', semanticRole: 'icon' }),
    ]),
    validConfig(),
  )

  assert.deepEqual(result.issues.map(({ nodeId }) => nodeId), ['a', 'z'])
  assert.equal(result.summary.errors, 2)
  assert.equal(exitCodeForResult(result), 1)
  assert.match(formatHumanReport(result), /2 errors, 0 warnings/)
  assert.match(formatHumanReport(result), /TEXT_GLYPH_ICON.*node a/)
})

test('CLI returns 0 for clean input, 1 for violations, and 2 for invalid input', () => {
  const directory = mkdtempSync(join(tmpdir(), 'figma-audit-'))
  const configPath = join(directory, 'config.json')
  const cleanPath = join(directory, 'clean.json')
  const failingPath = join(directory, 'failing.json')
  const invalidPath = join(directory, 'invalid.json')

  writeFileSync(configPath, JSON.stringify(validConfig()))
  writeFileSync(cleanPath, JSON.stringify(validSnapshot()))
  writeFileSync(
    failingPath,
    JSON.stringify(
      validSnapshot([figmaNode({ id: 'glyph', type: 'TEXT', text: '⌄', semanticRole: 'icon' })]),
    ),
  )
  writeFileSync(invalidPath, JSON.stringify({ schemaVersion: 9 }))

  const run = (snapshotPath, ...args) =>
    spawnSync(process.execPath, [scriptPath.pathname, '--config', configPath, ...args, snapshotPath], {
      encoding: 'utf8',
    })

  assert.equal(run(cleanPath).status, 0)
  assert.equal(run(failingPath).status, 1)
  assert.equal(run(invalidPath).status, 2)

  const jsonRun = run(failingPath, '--json')
  assert.equal(JSON.parse(jsonRun.stdout).summary.errors, 1)
})
