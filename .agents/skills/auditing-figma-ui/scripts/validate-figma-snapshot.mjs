#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SCHEMA_VERSION = 1
const GLYPH_PATTERN = /^[⌄⌃⌁⌂⌘⌕⌗⌙⌫⌁→←↑↓✓✕×…⋮⋯]+$/u
const CONFIG_KEYS = new Set([
  'allowedAbsoluteNodeIds',
  'contentRegions',
  'controlProfiles',
  'dynamicContainerNodeIds',
  'exceptions',
  'modalCenterTolerance',
  'modalWhitespaceThreshold',
  'pages',
  'reactionBaselines',
  'requiredStates',
  'schemaVersion',
])

export class SnapshotInputError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SnapshotInputError'
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SnapshotInputError(`${label} must be an object`)
  }
}

function validateInputs(snapshot, config) {
  assertObject(snapshot, 'snapshot')
  assertObject(config, 'config')

  if (snapshot.schemaVersion !== SCHEMA_VERSION) {
    throw new SnapshotInputError(
      `snapshot schemaVersion must be ${SCHEMA_VERSION}; received ${String(snapshot.schemaVersion)}`,
    )
  }
  if (config.schemaVersion !== SCHEMA_VERSION) {
    throw new SnapshotInputError(
      `config schemaVersion must be ${SCHEMA_VERSION}; received ${String(config.schemaVersion)}`,
    )
  }
  if (!snapshot.page?.id || !snapshot.page?.name) {
    throw new SnapshotInputError('snapshot.page must include id and name')
  }
  if (!Array.isArray(snapshot.nodes)) {
    throw new SnapshotInputError('snapshot.nodes must be an array')
  }
  if (!Array.isArray(config.exceptions ?? [])) {
    throw new SnapshotInputError('config.exceptions must be an array')
  }
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new SnapshotInputError(`unknown config key: ${key}`)
  }
  for (const [index, exception] of (config.exceptions ?? []).entries()) {
    assertObject(exception, `config.exceptions[${index}]`)
    if (
      typeof exception.nodeId !== 'string' ||
      exception.nodeId.trim() === '' ||
      /[*?]/.test(exception.nodeId)
    ) {
      throw new SnapshotInputError(`config.exceptions[${index}] must target a single exact nodeId`)
    }
    if (typeof exception.ruleId !== 'string' || exception.ruleId.trim() === '') {
      throw new SnapshotInputError(`config.exceptions[${index}] must include a non-empty ruleId`)
    }
    if (typeof exception.reason !== 'string' || exception.reason.trim() === '') {
      throw new SnapshotInputError(`config.exceptions[${index}] must include a non-empty reason`)
    }
  }

  for (const [index, node] of snapshot.nodes.entries()) {
    assertObject(node, `snapshot.nodes[${index}]`)
    if (!node.id || !node.type) {
      throw new SnapshotInputError(`snapshot.nodes[${index}] must include id and type`)
    }
    for (const key of ['x', 'y', 'width', 'height']) {
      if (!Number.isFinite(node[key])) {
        throw new SnapshotInputError(`snapshot.nodes[${index}].${key} must be a finite number`)
      }
    }
  }
}

function createNodeIndex(nodes) {
  const index = new Map()
  for (const node of nodes) {
    if (index.has(node.id)) {
      throw new SnapshotInputError(`duplicate node id: ${node.id}`)
    }
    index.set(node.id, node)
  }
  return index
}

function isEffectivelyVisible(node, index, visiting = new Set()) {
  if (node.visible === false) return false
  if (!node.parentId) return true
  if (visiting.has(node.id)) throw new SnapshotInputError(`cyclic parent relationship at ${node.id}`)
  const parent = index.get(node.parentId)
  if (!parent) return true
  visiting.add(node.id)
  const visible = isEffectivelyVisible(parent, index, visiting)
  visiting.delete(node.id)
  return visible
}

function absolutePosition(node, index, visiting = new Set()) {
  if (Number.isFinite(node.absoluteX) && Number.isFinite(node.absoluteY)) {
    return { x: node.absoluteX, y: node.absoluteY }
  }
  if (!node.parentId) return { x: node.x, y: node.y }
  if (visiting.has(node.id)) throw new SnapshotInputError(`cyclic parent relationship at ${node.id}`)
  const parent = index.get(node.parentId)
  if (!parent) return { x: node.x, y: node.y }
  visiting.add(node.id)
  const parentPosition = absolutePosition(parent, index, visiting)
  visiting.delete(node.id)
  return { x: parentPosition.x + node.x, y: parentPosition.y + node.y }
}

function rectFor(node, index) {
  const { x, y } = absolutePosition(node, index)
  return { x, y, width: node.width, height: node.height }
}

function intersection(a, b) {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  const width = right - left
  const height = bottom - top
  return width > 0 && height > 0 ? { width, height } : null
}

function clippingAncestor(node, index) {
  let current = node.parentId ? index.get(node.parentId) : undefined
  const visited = new Set()
  while (current) {
    if (visited.has(current.id)) throw new SnapshotInputError(`cyclic parent relationship at ${current.id}`)
    if (current.clipsContent === true) return current
    visited.add(current.id)
    current = current.parentId ? index.get(current.parentId) : undefined
  }
  return null
}

function createIssue(snapshot, node, ruleId, message, measurements = {}, severity = 'error') {
  return {
    severity,
    ruleId,
    pageId: snapshot.page.id,
    nodeId: node.id,
    message,
    measurements,
  }
}

function childrenOf(parentId, nodes) {
  return nodes.filter((node) => node.parentId === parentId)
}

function isAllowedAbsolute(node, config) {
  if ((config.allowedAbsoluteNodeIds ?? []).includes(node.id)) return true
  if (['hotspot', 'background', 'target-highlight'].includes(node.semanticRole)) return true
  return node.semanticRole === 'icon' && node.width <= 24 && node.height <= 24
}

function manualFlowIssues(snapshot, config, index) {
  const issues = []
  for (const parent of snapshot.nodes) {
    if (!isEffectivelyVisible(parent, index)) continue
    const children = childrenOf(parent.id, snapshot.nodes).filter(
      (child) =>
        isEffectivelyVisible(child, index) &&
        child.layoutPositioning !== 'ABSOLUTE' &&
        !['background', 'hotspot', 'overlay', 'target-highlight'].includes(child.semanticRole),
    )

    if (
      parent.semanticRole !== 'content-region' &&
      parent.layoutMode === 'NONE' &&
      children.length >= 3
    ) {
      const orderedX = [...children].sort((a, b) => a.x - b.x)
      const orderedY = [...children].sort((a, b) => a.y - b.y)
      const horizontal = orderedX.every(
        (child, childIndex) =>
          childIndex === 0 || orderedX[childIndex - 1].x + orderedX[childIndex - 1].width <= child.x,
      )
      const vertical = orderedY.every(
        (child, childIndex) =>
          childIndex === 0 || orderedY[childIndex - 1].y + orderedY[childIndex - 1].height <= child.y,
      )
      if (horizontal || vertical) {
        issues.push(
          createIssue(
            snapshot,
            parent,
            'MANUAL_FLOW_LAYOUT',
            `${children.length} ordered children rely on manual coordinates`,
            { axis: vertical ? 'vertical' : 'horizontal', childCount: children.length },
            'warning',
          ),
        )
      }
    }

    if (parent.layoutMode && parent.layoutMode !== 'NONE') {
      for (const child of childrenOf(parent.id, snapshot.nodes)) {
        if (
          child.layoutPositioning === 'ABSOLUTE' &&
          isEffectivelyVisible(child, index) &&
          !isAllowedAbsolute(child, config)
        ) {
          issues.push(
            createIssue(
              snapshot,
              child,
              'MANUAL_FLOW_LAYOUT',
              `absolute child is detached from ${parent.layoutMode.toLowerCase()} auto layout`,
              { parentId: parent.id },
              'warning',
            ),
          )
        }
      }
    }
  }
  return issues
}

function fixedDynamicIssues(snapshot, config, index) {
  const issues = []
  for (const nodeId of config.dynamicContainerNodeIds ?? []) {
    const container = index.get(nodeId)
    if (!container || !isEffectivelyVisible(container, index)) continue
    if (container.layoutSizingHorizontal !== 'FIXED') continue
    const labels = childrenOf(container.id, snapshot.nodes).filter(
      (node) => node.type === 'TEXT' && isEffectivelyVisible(node, index),
    )
    const hasSafeOverflowPolicy =
      container.overflowDirection === 'HORIZONTAL' ||
      container.clipsContent === true ||
      labels.every((label) => label.textTruncation === 'ENDING' && label.maxLines === 1)
    if (labels.length > 0 && !hasSafeOverflowPolicy) {
      issues.push(
        createIssue(
          snapshot,
          container,
          'FIXED_DYNAMIC_CONTAINER',
          'fixed dynamic container has no clipping, scrolling, or single-line truncation policy',
          { labelCount: labels.length, width: container.width },
          'warning',
        ),
      )
    }
  }
  return issues
}

function resolveContentRegion(snapshot, config, modal, index) {
  const configured = config.contentRegions?.[snapshot.page.id]
  if (!configured) return null
  if (configured.mode !== 'snapshot-role') return configured

  if (modal.contentRegionId) {
    const referenced = index.get(modal.contentRegionId)
    if (referenced?.semanticRole === 'content-region') return rectFor(referenced, index)
  }
  const modalRect = rectFor(modal, index)
  const center = {
    x: modalRect.x + modalRect.width / 2,
    y: modalRect.y + modalRect.height / 2,
  }
  const containing = snapshot.nodes
    .filter((node) => node.semanticRole === 'content-region')
    .map((node) => rectFor(node, index))
    .filter(
      (region) =>
        center.x >= region.x &&
        center.x <= region.x + region.width &&
        center.y >= region.y &&
        center.y <= region.y + region.height,
    )
    .sort((a, b) => a.width * a.height - b.width * b.height)
  return containing[0] ?? null
}

function modalIssues(snapshot, config, index) {
  const issues = []
  for (const modal of snapshot.nodes.filter(
    (node) => node.semanticRole === 'modal' && isEffectivelyVisible(node, index),
  )) {
    const contentRegion = resolveContentRegion(snapshot, config, modal, index)
    const modalRect = rectFor(modal, index)
    if (contentRegion) {
      const overflow = {
        overflowBottom: Math.max(
          0,
          modalRect.y + modalRect.height - (contentRegion.y + contentRegion.height),
        ),
        overflowLeft: Math.max(0, contentRegion.x - modalRect.x),
        overflowRight: Math.max(
          0,
          modalRect.x + modalRect.width - (contentRegion.x + contentRegion.width),
        ),
        overflowTop: Math.max(0, contentRegion.y - modalRect.y),
      }
      if (Object.values(overflow).some((value) => value > 0)) {
        issues.push(
          createIssue(
            snapshot,
            modal,
            'MODAL_OUTSIDE_CONTENT',
            'modal extends outside the configured content region',
            overflow,
          ),
        )
      }

      const deltaX =
        modalRect.x + modalRect.width / 2 - (contentRegion.x + contentRegion.width / 2)
      const deltaY =
        modalRect.y + modalRect.height / 2 - (contentRegion.y + contentRegion.height / 2)
      const tolerance = config.modalCenterTolerance ?? 24
      if (Math.abs(deltaX) > tolerance || Math.abs(deltaY) > tolerance) {
        issues.push(
          createIssue(
            snapshot,
            modal,
            'MODAL_NOT_CENTERED',
            'modal is not centered in the configured content region',
            { deltaX, deltaY, tolerance },
            'warning',
          ),
        )
      }
    }

    const contentChildren = childrenOf(modal.id, snapshot.nodes).filter(
      (node) =>
        isEffectivelyVisible(node, index) &&
        !['background', 'hotspot', 'scroll-region'].includes(node.semanticRole),
    )
    if (contentChildren.length > 0) {
      const contentBottom = Math.max(...contentChildren.map((node) => node.y + node.height))
      const whitespace = Math.max(0, modal.height - contentBottom)
      const threshold = config.modalWhitespaceThreshold ?? 160
      if (whitespace > threshold) {
        issues.push(
          createIssue(
            snapshot,
            modal,
            'EXCESSIVE_VERTICAL_WHITESPACE',
            'modal has excessive unused space below visible content',
            { threshold, whitespace },
            'warning',
          ),
        )
      }
    }
  }
  return issues
}

function profileForNode(node, profiles) {
  if (!node.sourceComponentId) return null
  return profiles.find((profile) => profile.sourceComponentIds?.includes(node.sourceComponentId)) ?? null
}

function visibleInlineChildren(control, nodes, index) {
  return childrenOf(control.id, nodes).filter(
    (child) =>
      isEffectivelyVisible(child, index) &&
      child.layoutPositioning !== 'ABSOLUTE' &&
      !['background', 'hotspot'].includes(child.semanticRole),
  )
}

function controlMeasurements(control, profile, nodes, index) {
  const children = visibleInlineChildren(control, nodes, index)
  const gapCount = Math.max(0, children.length - 1)
  const itemSpacing = control.itemSpacing ?? 0
  const requiredWidth =
    children.reduce((total, child) => total + child.width, 0) + itemSpacing * gapCount
  const paddingLeft = control.paddingLeft ?? 0
  const paddingRight = control.paddingRight ?? 0
  const label = children.find((child) => child.semanticRole === profile.labelRole)
  return {
    availableWidth: control.width - paddingLeft - paddingRight,
    children,
    label,
    hasExplicitPadding: Number.isFinite(control.paddingLeft) && Number.isFinite(control.paddingRight),
    paddingLeft,
    paddingRight,
    requiredWidth,
  }
}

function controlProfileIssues(snapshot, config, index) {
  const profiles = config.controlProfiles ?? []
  const issues = []
  const matched = snapshot.nodes
    .map((node) => ({ node, profile: profileForNode(node, profiles) }))
    .filter(({ node, profile }) => profile && isEffectivelyVisible(node, index))

  for (const { node: control, profile } of matched) {
    const measurements = controlMeasurements(control, profile, snapshot.nodes, index)
    const budget = {
      availableWidth: measurements.availableWidth,
      requiredWidth: measurements.requiredWidth,
    }
    if (measurements.requiredWidth > control.width) {
      issues.push(
        createIssue(
          snapshot,
          control,
          'CONTROL_CONTENT_OVERFLOW',
          'visible inline content is wider than the control',
          budget,
        ),
      )
    } else if (measurements.requiredWidth > measurements.availableWidth) {
      issues.push(
        createIssue(
          snapshot,
          control,
          'CONTROL_PADDING_BREAKS_CONTENT',
          'horizontal padding leaves insufficient width for visible inline content',
          budget,
        ),
      )
    }

    const paddingOutsideRange =
      measurements.hasExplicitPadding &&
      ((Number.isFinite(profile.minPaddingX) &&
        (measurements.paddingLeft < profile.minPaddingX ||
          measurements.paddingRight < profile.minPaddingX)) ||
        (Number.isFinite(profile.maxPaddingX) &&
        (measurements.paddingLeft > profile.maxPaddingX ||
          measurements.paddingRight > profile.maxPaddingX)))
    if (paddingOutsideRange) {
      issues.push(
        createIssue(
          snapshot,
          control,
          'CONTROL_PADDING_OUTLIER',
          'horizontal padding is outside the configured control profile',
          {
            maxPaddingX: profile.maxPaddingX ?? null,
            minPaddingX: profile.minPaddingX ?? null,
            paddingLeft: measurements.paddingLeft,
            paddingRight: measurements.paddingRight,
          },
          'warning',
        ),
      )
    }

    if (
      profile.dynamicLabel === true &&
      profile.fixedWidth === true &&
      measurements.label &&
      (measurements.label.textTruncation !== 'ENDING' || measurements.label.maxLines !== 1)
    ) {
      issues.push(
        createIssue(
          snapshot,
          measurements.label,
          'CONTROL_LABEL_NO_ELLIPSIS',
          'dynamic fixed-width label must use single-line ending truncation',
          {
            maxLines: measurements.label.maxLines ?? null,
            textTruncation: measurements.label.textTruncation ?? null,
          },
        ),
      )
    }
  }

  const stateGroups = new Map()
  for (const entry of matched.filter(({ profile }) => profile.compareStateGeometry === true)) {
    const groupId = entry.node.auditGroupId
    if (!groupId) continue
    const key = `${entry.profile.id}:${groupId}`
    const group = stateGroups.get(key) ?? []
    group.push(entry)
    stateGroups.set(key, group)
  }

  for (const group of stateGroups.values()) {
    if (group.length < 2) continue
    const ordered = [...group].sort((a, b) => {
      const aState = a.node.variantProperties?.State ?? ''
      const bState = b.node.variantProperties?.State ?? ''
      const aPriority = aState === 'normal' ? 0 : 1
      const bPriority = bState === 'normal' ? 0 : 1
      return aPriority - bPriority || aState.localeCompare(bState) || a.node.id.localeCompare(b.node.id)
    })
    const reference = ordered[0]
    const referenceMeasure = controlMeasurements(
      reference.node,
      reference.profile,
      snapshot.nodes,
      index,
    )
    const referenceLabel = referenceMeasure.label
    for (const entry of ordered.slice(1)) {
      const measurement = controlMeasurements(entry.node, entry.profile, snapshot.nodes, index)
      const label = measurement.label
      const changed =
        entry.node.width !== reference.node.width ||
        entry.node.height !== reference.node.height ||
        measurement.paddingLeft !== referenceMeasure.paddingLeft ||
        measurement.paddingRight !== referenceMeasure.paddingRight ||
        (label?.x ?? null) !== (referenceLabel?.x ?? null) ||
        (label?.y ?? null) !== (referenceLabel?.y ?? null)
      if (!changed) continue
      issues.push(
        createIssue(
          snapshot,
          entry.node,
          'CONTROL_GEOMETRY_DRIFT',
          'control geometry changes across visual states',
          {
            referenceState: reference.node.variantProperties?.State ?? null,
            state: entry.node.variantProperties?.State ?? null,
            reference: {
              height: reference.node.height,
              labelX: referenceLabel?.x ?? null,
              labelY: referenceLabel?.y ?? null,
              paddingLeft: referenceMeasure.paddingLeft,
              paddingRight: referenceMeasure.paddingRight,
              width: reference.node.width,
            },
            actual: {
              height: entry.node.height,
              labelX: label?.x ?? null,
              labelY: label?.y ?? null,
              paddingLeft: measurement.paddingLeft,
              paddingRight: measurement.paddingRight,
              width: entry.node.width,
            },
          },
          'warning',
        ),
      )
    }
  }

  return issues
}

function reactionIssues(snapshot, config, index) {
  const issues = []
  let reactionCount = 0
  for (const node of snapshot.nodes) {
    if (!isEffectivelyVisible(node, index) || !Array.isArray(node.reactions)) continue
    reactionCount += node.reactions.length
    for (const reaction of node.reactions) {
      const destinationId = reaction?.action?.destinationId
      if (typeof destinationId === 'string' && destinationId !== '' && !index.has(destinationId)) {
        issues.push(
          createIssue(
            snapshot,
            node,
            'REACTION_TARGET_MISSING',
            `reaction target ${destinationId} does not exist in the snapshot`,
            { destinationId },
          ),
        )
      }
    }
  }

  const baseline = config.reactionBaselines?.[snapshot.page.id]
  if (Number.isFinite(baseline) && reactionCount < baseline) {
    issues.push(
      createIssue(
        snapshot,
        { id: snapshot.page.id },
        'REACTION_COUNT_REGRESSION',
        'page reaction count is below its configured baseline',
        { actual: reactionCount, baseline },
        'warning',
      ),
    )
  }
  return issues
}

function requiredStateIssues(snapshot, config) {
  const issues = []
  for (const requirement of config.requiredStates ?? []) {
    if (requirement.pageId && requirement.pageId !== snapshot.page.id) continue
    const matching = snapshot.nodes.filter(
      (node) => node.sourceComponentId === requirement.sourceComponentId,
    )
    const actualStates = new Set(
      matching
        .map((node) => node.variantProperties?.[requirement.property])
        .filter((value) => typeof value === 'string'),
    )
    const missingStates = (requirement.values ?? []).filter((state) => !actualStates.has(state))
    if (missingStates.length === 0) continue
    issues.push(
      createIssue(
        snapshot,
        matching[0] ?? { id: requirement.sourceComponentId },
        'REQUIRED_STATE_MISSING',
        `component is missing required ${requirement.property} states: ${missingStates.join(', ')}`,
        {
          missingStates,
          property: requirement.property,
          sourceComponentId: requirement.sourceComponentId,
        },
      ),
    )
  }
  return issues
}

function textBoundsIssue(snapshot, node, index) {
  if (node.type !== 'TEXT' || !isEffectivelyVisible(node, index)) return null
  const parent = clippingAncestor(node, index)
  if (!parent) return null
  const childRect = rectFor(node, index)
  const parentRect = rectFor(parent, index)
  const measurements = {
    overflowBottom: Math.max(0, childRect.y + childRect.height - (parentRect.y + parentRect.height)),
    overflowLeft: Math.max(0, parentRect.x - childRect.x),
    overflowRight: Math.max(0, childRect.x + childRect.width - (parentRect.x + parentRect.width)),
    overflowTop: Math.max(0, parentRect.y - childRect.y),
  }
  if (Object.values(measurements).every((value) => value === 0)) return null

  const directions = Object.entries(measurements)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${key.replace('overflow', '').toLowerCase()} ${value}px`)
    .join(', ')
  return createIssue(
    snapshot,
    node,
    'TEXT_OUT_OF_BOUNDS',
    `text exceeds clipping ancestor ${parent.id}: ${directions}`,
    measurements,
  )
}

function glyphIssue(snapshot, node, index) {
  if (
    node.type !== 'TEXT' ||
    node.semanticRole !== 'icon' ||
    !isEffectivelyVisible(node, index) ||
    typeof node.text !== 'string' ||
    !GLYPH_PATTERN.test(node.text.trim())
  ) {
    return null
  }
  return createIssue(
    snapshot,
    node,
    'TEXT_GLYPH_ICON',
    'interface icon is represented by a text glyph',
    { text: node.text },
  )
}

function overlapIssues(snapshot, nodes, index, type, parentType, ruleId) {
  const candidates = nodes.filter(
    (node) =>
      node.type === type &&
      isEffectivelyVisible(node, index) &&
      (parentType === null || index.get(node.parentId)?.type === parentType),
  )
  const byParent = new Map()
  for (const node of candidates) {
    const parentId = node.parentId ?? '__root__'
    const siblings = byParent.get(parentId) ?? []
    siblings.push(node)
    byParent.set(parentId, siblings)
  }
  const issues = []

  for (const siblings of byParent.values()) {
    const ordered = [...siblings].sort((a, b) => {
      const left = rectFor(a, index)
      const right = rectFor(b, index)
      return left.x - right.x || left.y - right.y || a.id.localeCompare(b.id)
    })
    for (let rightIndex = 1; rightIndex < ordered.length; rightIndex += 1) {
      const current = ordered[rightIndex]
      for (let leftIndex = 0; leftIndex < rightIndex; leftIndex += 1) {
        const previous = ordered[leftIndex]
        const overlap = intersection(rectFor(previous, index), rectFor(current, index))
        if (!overlap) continue
        issues.push(
          createIssue(
            snapshot,
            current,
            ruleId,
            `${current.type.toLowerCase()} overlaps ${previous.id}`,
            { overlapHeight: overlap.height, overlapWidth: overlap.width },
          ),
        )
        break
      }
    }
  }
  return issues
}

function exceptionFor(issue, exceptions) {
  return exceptions.find(
    (exception) => exception.ruleId === issue.ruleId && exception.nodeId === issue.nodeId,
  )
}

function compareIssues(a, b) {
  const severityOrder = { error: 0, warning: 1 }
  return (
    severityOrder[a.severity] - severityOrder[b.severity] ||
    a.pageId.localeCompare(b.pageId) ||
    a.ruleId.localeCompare(b.ruleId) ||
    a.nodeId.localeCompare(b.nodeId) ||
    a.message.localeCompare(b.message)
  )
}

export function validateSnapshot(snapshot, config) {
  validateInputs(snapshot, config)
  const index = createNodeIndex(snapshot.nodes)
  const candidates = []

  for (const node of snapshot.nodes) {
    const boundsIssue = textBoundsIssue(snapshot, node, index)
    if (boundsIssue) candidates.push(boundsIssue)
    const iconIssue = glyphIssue(snapshot, node, index)
    if (iconIssue) candidates.push(iconIssue)
  }

  candidates.push(
    ...overlapIssues(snapshot, snapshot.nodes, index, 'COMPONENT', 'COMPONENT_SET', 'VARIANT_OVERLAP'),
    ...overlapIssues(snapshot, snapshot.nodes, index, 'SECTION', null, 'SECTION_OVERLAP'),
    ...manualFlowIssues(snapshot, config, index),
    ...fixedDynamicIssues(snapshot, config, index),
    ...modalIssues(snapshot, config, index),
    ...controlProfileIssues(snapshot, config, index),
    ...reactionIssues(snapshot, config, index),
    ...requiredStateIssues(snapshot, config),
  )

  const issues = []
  const exceptionsApplied = []
  for (const issue of candidates) {
    const exception = exceptionFor(issue, config.exceptions ?? [])
    if (exception) {
      exceptionsApplied.push({
        nodeId: exception.nodeId,
        reason: exception.reason,
        ruleId: exception.ruleId,
      })
    } else {
      issues.push(issue)
    }
  }
  issues.sort(compareIssues)
  exceptionsApplied.sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.nodeId.localeCompare(b.nodeId))

  return {
    fileKey: snapshot.fileKey ?? null,
    page: snapshot.page,
    issues,
    exceptionsApplied,
    summary: {
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
      exceptions: exceptionsApplied.length,
    },
  }
}

export function exitCodeForResult(result) {
  return result.summary.errors > 0 ? 1 : 0
}

export function formatHumanReport(result) {
  const lines = [
    `Figma UI audit — ${result.summary.errors} errors, ${result.summary.warnings} warnings, ${result.summary.exceptions} exceptions`,
  ]
  for (const issue of result.issues) {
    lines.push(
      `[${issue.severity.toUpperCase()}] ${issue.ruleId} page ${issue.pageId} node ${issue.nodeId}: ${issue.message}`,
    )
  }
  for (const exception of result.exceptionsApplied) {
    lines.push(`[EXCEPTION] ${exception.ruleId} node ${exception.nodeId}: ${exception.reason}`)
  }
  return `${lines.join('\n')}\n`
}

function parseArgs(argv) {
  const options = { configPath: null, json: false, snapshotPaths: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--config') {
      options.configPath = argv[index + 1] ?? null
      index += 1
    } else if (arg === '--json') {
      options.json = true
    } else if (arg.startsWith('-')) {
      throw new SnapshotInputError(`unknown option: ${arg}`)
    } else {
      options.snapshotPaths.push(arg)
    }
  }
  if (!options.configPath) throw new SnapshotInputError('--config is required')
  if (options.snapshotPaths.length === 0) throw new SnapshotInputError('at least one snapshot path is required')
  return options
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new SnapshotInputError(`${label} ${path} could not be read: ${error.message}`)
  }
}

function combineResults(results) {
  const issues = results.flatMap((result) => result.issues).sort(compareIssues)
  const exceptionsApplied = results
    .flatMap((result) => result.exceptionsApplied)
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.nodeId.localeCompare(b.nodeId))
  return {
    pages: results.map((result) => result.page),
    issues,
    exceptionsApplied,
    summary: {
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
      exceptions: exceptionsApplied.length,
    },
  }
}

export function runCli(argv) {
  try {
    const options = parseArgs(argv)
    const config = readJson(options.configPath, 'config')
    const result = combineResults(
      options.snapshotPaths.map((path) => validateSnapshot(readJson(path, 'snapshot'), config)),
    )
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatHumanReport(result))
    return exitCodeForResult(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Figma UI audit input error: ${message}\n`)
    return 2
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCli(process.argv.slice(2))
}
