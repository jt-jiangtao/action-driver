#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SCHEMA_VERSION = 1
const GLYPH_PATTERN = /^[⌄⌃⌁⌂⌘⌕⌗⌙⌫⌁→←↑↓✓✕×…⋮⋯]+$/u

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

function createIssue(snapshot, node, ruleId, message, measurements = {}) {
  return {
    severity: 'error',
    ruleId,
    pageId: snapshot.page.id,
    nodeId: node.id,
    message,
    measurements,
  }
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
