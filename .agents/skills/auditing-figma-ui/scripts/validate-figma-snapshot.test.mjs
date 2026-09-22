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

test('warns for manual sequential flow but permits registered overlays and hotspots', () => {
  const result = validateSnapshot(
    validSnapshot([
      figmaNode({ id: 'flow', width: 300, height: 180, layoutMode: 'NONE' }),
      figmaNode({ id: 'row-a', parentId: 'flow', y: 8, width: 280, height: 40 }),
      figmaNode({ id: 'row-b', parentId: 'flow', y: 56, width: 280, height: 40 }),
      figmaNode({ id: 'row-c', parentId: 'flow', y: 104, width: 280, height: 40 }),
      figmaNode({
        id: 'menu-overlay',
        parentId: 'flow',
        x: 220,
        y: 12,
        width: 64,
        height: 80,
        layoutPositioning: 'ABSOLUTE',
        semanticRole: 'overlay',
      }),
      figmaNode({
        id: 'prototype-hotspot',
        parentId: 'flow',
        width: 40,
        height: 40,
        layoutPositioning: 'ABSOLUTE',
        semanticRole: 'hotspot',
      }),
    ]),
    validConfig({ allowedAbsoluteNodeIds: ['menu-overlay'] }),
  )

  assert.ok(result.issues.some((issue) => issue.ruleId === 'MANUAL_FLOW_LAYOUT'))
  assert.ok(!result.issues.some((issue) => issue.nodeId === 'menu-overlay'))
  assert.ok(!result.issues.some((issue) => issue.nodeId === 'prototype-hotspot'))
})

test('warns for an unregistered absolute child in auto layout but permits a small icon', () => {
  const result = validateSnapshot(
    validSnapshot([
      figmaNode({ id: 'auto', layoutMode: 'HORIZONTAL', width: 240, height: 48 }),
      figmaNode({
        id: 'absolute-label',
        parentId: 'auto',
        type: 'TEXT',
        text: 'Detached',
        layoutPositioning: 'ABSOLUTE',
        width: 72,
        height: 20,
      }),
      figmaNode({
        id: 'icon',
        parentId: 'auto',
        semanticRole: 'icon',
        layoutPositioning: 'ABSOLUTE',
        x: 208,
        y: 16,
        width: 16,
        height: 16,
      }),
    ]),
    validConfig(),
  )

  assert.ok(
    result.issues.some(
      (issue) => issue.ruleId === 'MANUAL_FLOW_LAYOUT' && issue.nodeId === 'absolute-label',
    ),
  )
  assert.ok(!result.issues.some((issue) => issue.nodeId === 'icon'))
})

test('warns when a fixed dynamic container has no overflow policy', () => {
  const result = validateSnapshot(
    validSnapshot([
      figmaNode({
        id: 'dynamic-select',
        layoutMode: 'HORIZONTAL',
        layoutSizingHorizontal: 'FIXED',
        width: 112,
        height: 32,
      }),
      figmaNode({
        id: 'dynamic-label',
        parentId: 'dynamic-select',
        type: 'TEXT',
        text: 'claude-opus-4-1-20260805',
        width: 140,
        height: 20,
        textTruncation: 'DISABLED',
        maxLines: null,
      }),
    ]),
    validConfig({ dynamicContainerNodeIds: ['dynamic-select'] }),
  )

  assert.ok(
    result.issues.some(
      (issue) => issue.ruleId === 'FIXED_DYNAMIC_CONTAINER' && issue.nodeId === 'dynamic-select',
    ),
  )
})

test('checks modal bounds and centering against the configured content region', () => {
  const config = validConfig({
    contentRegions: { '60:2': { x: 200, y: 0, width: 1000, height: 800 } },
    modalCenterTolerance: 24,
  })
  const centered = validateSnapshot(
    validSnapshot([
      figmaNode({ id: 'modal', semanticRole: 'modal', x: 450, y: 200, width: 500, height: 400 }),
    ]),
    config,
  )
  const outside = validateSnapshot(
    validSnapshot([
      figmaNode({ id: 'modal', semanticRole: 'modal', x: 80, y: 80, width: 500, height: 400 }),
    ]),
    config,
  )

  assert.ok(!centered.issues.some((issue) => issue.ruleId.startsWith('MODAL_')))
  assert.ok(outside.issues.some((issue) => issue.ruleId === 'MODAL_OUTSIDE_CONTENT'))
  assert.ok(outside.issues.some((issue) => issue.ruleId === 'MODAL_NOT_CENTERED'))
})

test('warns for excessive modal whitespace but ignores drawer scroll space', () => {
  const snapshot = validSnapshot([
    figmaNode({ id: 'modal', semanticRole: 'modal', x: 300, y: 100, width: 500, height: 600 }),
    figmaNode({ id: 'modal-content', parentId: 'modal', x: 24, y: 24, width: 452, height: 120 }),
    figmaNode({ id: 'drawer', semanticRole: 'drawer', x: 900, width: 300, height: 800 }),
    figmaNode({
      id: 'drawer-scroll',
      parentId: 'drawer',
      semanticRole: 'scroll-region',
      width: 300,
      height: 300,
    }),
  ])
  const result = validateSnapshot(
    snapshot,
    validConfig({
      contentRegions: { '60:2': { x: 0, y: 0, width: 1200, height: 800 } },
      modalWhitespaceThreshold: 160,
    }),
  )

  assert.ok(
    result.issues.some(
      (issue) => issue.ruleId === 'EXCESSIVE_VERTICAL_WHITESPACE' && issue.nodeId === 'modal',
    ),
  )
  assert.ok(!result.issues.some((issue) => issue.nodeId === 'drawer'))
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
