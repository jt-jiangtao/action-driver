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

test('does not treat a fixed prototype content region as manual flow', () => {
  const result = validateSnapshot(
    validSnapshot([
      figmaNode({
        id: 'screen',
        semanticRole: 'content-region',
        layoutMode: 'NONE',
        width: 1440,
        height: 900,
      }),
      figmaNode({ id: 'header', parentId: 'screen', width: 1440, height: 64 }),
      figmaNode({ id: 'content', parentId: 'screen', y: 64, width: 1440, height: 760 }),
      figmaNode({ id: 'footer', parentId: 'screen', y: 824, width: 1440, height: 76 }),
    ]),
    validConfig(),
  )

  assert.ok(!result.issues.some((issue) => issue.ruleId === 'MANUAL_FLOW_LAYOUT'))
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

function controlConfig(profileOverrides = {}) {
  return validConfig({
    controlProfiles: [
      {
        id: 'select',
        sourceComponentIds: ['component:select'],
        labelRole: 'label',
        dynamicLabel: true,
        fixedWidth: true,
        allowedHeights: [32],
        minPaddingX: 8,
        maxPaddingX: 16,
        compareStateGeometry: true,
        ...profileOverrides,
      },
    ],
  })
}

function selectSnapshot({
  id = 'select',
  width = 112,
  paddingLeft = 12,
  paddingRight = 12,
  itemSpacing = 8,
  labelWidth = 64,
  text = 'gpt-5.2',
  textTruncation = 'ENDING',
  maxLines = 1,
  state = 'normal',
  auditGroupId = 'select-set',
} = {}) {
  return validSnapshot([
    figmaNode({
      id,
      sourceComponentId: 'component:select',
      auditGroupId,
      variantProperties: { State: state },
      layoutMode: 'HORIZONTAL',
      width,
      height: 32,
      paddingLeft,
      paddingRight,
      itemSpacing,
    }),
    figmaNode({
      id: `${id}-label`,
      parentId: id,
      type: 'TEXT',
      semanticRole: 'label',
      text,
      width: labelWidth,
      height: 20,
      textTruncation,
      maxLines,
    }),
    figmaNode({
      id: `${id}-chevron`,
      parentId: id,
      semanticRole: 'trailing-icon',
      x: labelWidth + itemSpacing,
      width: 16,
      height: 16,
    }),
  ])
}

test('accepts a select whose label, trailing icon, gaps, and padding exactly fit', () => {
  const result = validateSnapshot(
    selectSnapshot({ width: 104, labelWidth: 56, paddingLeft: 12, paddingRight: 12, itemSpacing: 8 }),
    controlConfig(),
  )

  assert.ok(!result.issues.some((issue) => issue.ruleId.startsWith('CONTROL_')))
})

test('reports when select padding leaves too little room for visible content', () => {
  const result = validateSnapshot(
    selectSnapshot({ width: 104, labelWidth: 64, paddingLeft: 12, paddingRight: 12, itemSpacing: 8 }),
    controlConfig(),
  )

  const issue = result.issues.find((candidate) => candidate.ruleId === 'CONTROL_PADDING_BREAKS_CONTENT')
  assert.deepEqual(issue?.measurements, { availableWidth: 80, requiredWidth: 88 })
})

test('reports content wider than the whole select and excessive padding separately', () => {
  const overflowing = validateSnapshot(
    selectSnapshot({ width: 80, labelWidth: 72, paddingLeft: 0, paddingRight: 0, itemSpacing: 8 }),
    controlConfig(),
  )
  const padded = validateSnapshot(
    selectSnapshot({ width: 160, labelWidth: 64, paddingLeft: 28, paddingRight: 28, itemSpacing: 8 }),
    controlConfig(),
  )

  assert.ok(overflowing.issues.some((issue) => issue.ruleId === 'CONTROL_CONTENT_OVERFLOW'))
  assert.ok(padded.issues.some((issue) => issue.ruleId === 'CONTROL_PADDING_OUTLIER'))
})

test('requires ellipsis for a dynamic fixed select label', () => {
  const result = validateSnapshot(
    selectSnapshot({
      text: 'claude-opus-4-1-20260805',
      textTruncation: 'DISABLED',
      maxLines: null,
    }),
    controlConfig(),
  )

  assert.ok(result.issues.some((issue) => issue.ruleId === 'CONTROL_LABEL_NO_ELLIPSIS'))
})

test('accepts a static HUG button and an icon-only square button without ellipsis', () => {
  const result = validateSnapshot(
    validSnapshot([
      figmaNode({
        id: 'action',
        sourceComponentId: 'component:button',
        layoutMode: 'HORIZONTAL',
        layoutSizingHorizontal: 'HUG',
        width: 88,
        height: 32,
        paddingLeft: 12,
        paddingRight: 12,
      }),
      figmaNode({
        id: 'action-label',
        parentId: 'action',
        type: 'TEXT',
        semanticRole: 'label',
        text: '保存更改',
        width: 64,
        height: 20,
        textTruncation: 'DISABLED',
      }),
      figmaNode({
        id: 'icon-button',
        sourceComponentId: 'component:button',
        layoutMode: 'HORIZONTAL',
        width: 32,
        height: 32,
        paddingLeft: 8,
        paddingRight: 8,
      }),
      figmaNode({
        id: 'icon-button-icon',
        parentId: 'icon-button',
        semanticRole: 'icon',
        width: 16,
        height: 16,
      }),
    ]),
    controlConfig({
      id: 'button',
      sourceComponentIds: ['component:button'],
      dynamicLabel: false,
      fixedWidth: false,
    }),
  )

  assert.ok(!result.issues.some((issue) => issue.ruleId === 'CONTROL_LABEL_NO_ELLIPSIS'))
  assert.ok(!result.issues.some((issue) => issue.nodeId === 'icon-button'))
})

test('reports geometry drift between select states', () => {
  const normal = selectSnapshot({ id: 'normal', state: 'normal' })
  const hover = selectSnapshot({ id: 'hover', state: 'hover', paddingLeft: 16, paddingRight: 8 })
  const result = validateSnapshot(
    { ...normal, nodes: [...normal.nodes, ...hover.nodes] },
    controlConfig(),
  )

  const issue = result.issues.find((candidate) => candidate.ruleId === 'CONTROL_GEOMETRY_DRIFT')
  assert.equal(issue?.nodeId, 'hover')
  assert.equal(issue?.measurements.referenceState, 'normal')
  assert.equal(issue?.measurements.state, 'hover')
})

test('does not invent padding outliers when a compact component snapshot omits padding', () => {
  const result = validateSnapshot(
    validSnapshot([
      figmaNode({
        id: 'compact-variant',
        sourceComponentId: 'component:select',
        paddingLeft: undefined,
        paddingRight: undefined,
      }),
    ]),
    controlConfig(),
  )

  assert.ok(!result.issues.some((issue) => issue.ruleId === 'CONTROL_PADDING_OUTLIER'))
})

test('reports a reaction whose internal target is missing but permits external actions', () => {
  const result = validateSnapshot(
    validSnapshot([
      figmaNode({
        id: 'internal-trigger',
        reactions: [{ action: { type: 'NODE', destinationId: 'missing-node' } }],
      }),
      figmaNode({
        id: 'external-trigger',
        reactions: [{ action: { type: 'URL', url: 'https://example.com/docs' } }],
      }),
    ]),
    validConfig(),
  )

  assert.deepEqual(
    result.issues
      .filter((issue) => issue.ruleId === 'REACTION_TARGET_MISSING')
      .map(({ nodeId }) => nodeId),
    ['internal-trigger'],
  )
})

test('warns when the page reaction count is below its configured baseline', () => {
  const result = validateSnapshot(
    validSnapshot([
      figmaNode({
        id: 'trigger',
        reactions: [{ action: { type: 'BACK' } }],
      }),
    ]),
    validConfig({ reactionBaselines: { '60:2': 3 } }),
  )

  const issue = result.issues.find((candidate) => candidate.ruleId === 'REACTION_COUNT_REGRESSION')
  assert.deepEqual(issue?.measurements, { actual: 1, baseline: 3 })
})

test('reports missing required component states and accepts a complete state matrix', () => {
  const requirement = {
    sourceComponentId: 'component:button',
    property: 'State',
    values: ['normal', 'hover', 'pressed', 'disabled'],
  }
  const nodes = ['normal', 'hover', 'pressed'].map((state, index) =>
    figmaNode({
      id: `button-${state}`,
      sourceComponentId: 'component:button',
      variantProperties: { State: state },
      x: index * 120,
    }),
  )
  const incomplete = validateSnapshot(
    validSnapshot(nodes),
    validConfig({ requiredStates: [requirement] }),
  )
  const complete = validateSnapshot(
    validSnapshot([
      ...nodes,
      figmaNode({
        id: 'button-disabled',
        sourceComponentId: 'component:button',
        variantProperties: { State: 'disabled' },
        x: 360,
      }),
    ]),
    validConfig({ requiredStates: [requirement] }),
  )

  assert.deepEqual(
    incomplete.issues.find((issue) => issue.ruleId === 'REQUIRED_STATE_MISSING')?.measurements,
    { missingStates: ['disabled'], property: 'State', sourceComponentId: 'component:button' },
  )
  assert.ok(!complete.issues.some((issue) => issue.ruleId === 'REQUIRED_STATE_MISSING'))
})

test('rejects unknown config keys, wildcard exceptions, and blank exception reasons', () => {
  assert.throws(
    () => validateSnapshot(validSnapshot(), validConfig({ surprise: true })),
    (error) => error instanceof SnapshotInputError && /unknown config key: surprise/.test(error.message),
  )
  assert.throws(
    () =>
      validateSnapshot(
        validSnapshot(),
        validConfig({ exceptions: [{ ruleId: 'TEXT_GLYPH_ICON', nodeId: '*', reason: 'all' }] }),
      ),
    (error) => error instanceof SnapshotInputError && /single exact nodeId/.test(error.message),
  )
  assert.throws(
    () =>
      validateSnapshot(
        validSnapshot(),
        validConfig({ exceptions: [{ ruleId: 'TEXT_GLYPH_ICON', nodeId: 'glyph', reason: ' ' }] }),
      ),
    (error) => error instanceof SnapshotInputError && /non-empty reason/.test(error.message),
  )
})

test('resolves a configured snapshot-role content region for modal checks', () => {
  const result = validateSnapshot(
    validSnapshot([
      figmaNode({
        id: 'screen',
        semanticRole: 'content-region',
        x: 200,
        width: 1000,
        height: 800,
      }),
      figmaNode({
        id: 'modal',
        semanticRole: 'modal',
        contentRegionId: 'screen',
        x: 80,
        y: 80,
        width: 500,
        height: 400,
      }),
    ]),
    validConfig({ contentRegions: { '60:2': { mode: 'snapshot-role' } } }),
  )

  assert.ok(result.issues.some((issue) => issue.ruleId === 'MODAL_OUTSIDE_CONTENT'))
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
