import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import ts from 'typescript'
import { validateContracts } from './contracts.mjs'

export const E2E_TEST_ID_PATTERN =
  /^e2e\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/(?:[a-z0-9]+(?:-[a-z0-9]+)*|:[a-z][a-z0-9-]*)){2,}#(?:button|link|input|checkbox|radio|option|menuitem|tab|page|section|nav|dialog|status|select|textarea|switch)$/

export const INTERACTIVE_TAGS = new Set([
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'summary'
])

export const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'option',
  'checkbox',
  'radio',
  'switch',
  'tab'
])

export const SHARED_INTERACTIVE_COMPONENTS = new Map([
  ['IconButton', 'testId'],
  ['TextButton', 'testId'],
  ['Checkbox', 'testId'],
  ['RadioOption', 'testId'],
  ['ModelToggle', 'testId'],
  ['TextField', 'testId'],
  ['SidebarEntry', 'testId'],
  ['Editable', 'data-testid']
])

function jsxTagName(node) {
  return node.tagName.getText()
}

function attributesOf(node) {
  return node.attributes.properties.filter(ts.isJsxAttribute)
}

function attribute(node, name) {
  return attributesOf(node).find((item) => item.name.getText() === name)
}

function literalAttributeValue(item) {
  if (!item?.initializer) return true
  if (ts.isStringLiteral(item.initializer)) return item.initializer.text
  if (
    ts.isJsxExpression(item.initializer) &&
    item.initializer.expression &&
    ts.isStringLiteralLike(item.initializer.expression)
  ) {
    return item.initializer.expression.text
  }
  return undefined
}

function interactionKind(node) {
  const tag = jsxTagName(node)
  const lowerTag = tag.toLowerCase()
  if (INTERACTIVE_TAGS.has(lowerTag)) return true
  if (SHARED_INTERACTIVE_COMPONENTS.has(tag)) return true
  if (attribute(node, 'contentEditable')) return true
  const role = literalAttributeValue(attribute(node, 'role'))
  return typeof role === 'string' && INTERACTIVE_ROLES.has(role)
}

function testIdReference(item) {
  if (!item?.initializer) return null
  if (ts.isStringLiteral(item.initializer)) return { kind: 'static', target: item.initializer.text }
  if (!ts.isJsxExpression(item.initializer) || !item.initializer.expression) return null
  const expression = item.initializer.expression
  if (ts.isStringLiteralLike(expression)) return { kind: 'static', target: expression.text }
  if (ts.isIdentifier(expression) && expression.text === 'testId') {
    return { kind: 'forwarded', target: 'testId' }
  }
  if (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'e2eId' &&
    expression.arguments[0] &&
    ts.isStringLiteralLike(expression.arguments[0])
  ) {
    return { kind: 'dynamic', target: expression.arguments[0].text }
  }
  return { kind: 'unapproved', target: expression.getText() }
}

function location(source, node, projectRoot) {
  const point = source.getLineAndCharacterOfPosition(node.getStart(source))
  return {
    file: relative(projectRoot, source.fileName),
    line: point.line + 1,
    column: point.character + 1
  }
}

export function validateInteractionSources({ files, projectRoot = process.cwd(), contracts }) {
  const errors = []
  const interactions = []
  const staticIds = new Map()

  const addError = (source, node, code, message) => {
    errors.push({ ...location(source, node, projectRoot), code, message })
  }

  for (const file of files) {
    const absolute = resolve(file)
    const source = ts.createSourceFile(
      absolute,
      readFileSync(absolute, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )

    const visit = (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = jsxTagName(node)
        const idAttributeName = SHARED_INTERACTIVE_COMPONENTS.get(tag) ?? 'data-testid'
        const idAttribute = attribute(node, idAttributeName)

        if (interactionKind(node) && !idAttribute) {
          addError(source, node, 'missing-test-id', `${tag} requires ${idAttributeName}`)
        }

        if (idAttribute) {
          const reference = testIdReference(idAttribute)
          if (!reference || reference.kind === 'unapproved') {
            addError(source, node, 'unapproved-dynamic-id', `${idAttributeName} must be a literal or e2eId()`)
          } else if (reference.kind === 'forwarded') {
            // The public shared component call site owns and registers the concrete id.
          } else if (!E2E_TEST_ID_PATTERN.test(reference.target)) {
            addError(source, node, 'invalid-test-id', `Invalid E2E test id: ${reference.target}`)
          } else {
            const item = { ...reference, ...location(source, node, projectRoot) }
            interactions.push(item)
            if (reference.kind === 'static') {
              const previous = staticIds.get(reference.target)
              if (previous) {
                addError(source, node, 'duplicate-test-id', `Duplicate E2E test id: ${reference.target}`)
              } else {
                staticIds.set(reference.target, item)
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }

    visit(source)
  }

  if (contracts !== undefined) {
    errors.push(...validateContracts(contracts, { projectRoot, interactions }).errors)
  }

  return { errors, interactions }
}
