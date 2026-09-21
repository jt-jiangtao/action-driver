import { expect, type Page } from '@playwright/test'

export type InteractionContract = {
  target: string
  route: string
  type: string
  coverage: 'functional' | 'visual-only'
  testFile?: string
  testName?: string
}

export type InteractionAuditResult = {
  interactiveIds: string[]
  renderedTargets: string[]
}

const interactiveSelector = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'summary',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]'
].join(',')

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function targetMatcher(target: string) {
  const expression = escapeRegex(target).replace(/:[a-z][a-z0-9-]*/g, '[^/#]+')
  return new RegExp(`^${expression}$`)
}

export async function auditRenderedInteractions(
  page: Page,
  contracts: InteractionContract[],
  expectedVisualTargets: string[] = []
): Promise<InteractionAuditResult> {
  const snapshot = await page.locator('body').evaluate((body, selector) => {
    const allTestIds = Array.from(body.querySelectorAll<HTMLElement>('[data-testid]')).map(
      (element) => element.dataset.testid ?? ''
    )
    const interactives = Array.from(body.querySelectorAll<HTMLElement>(selector)).map((element) => ({
      tag: element.tagName.toLowerCase(),
      label: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 80) ?? '',
      testId: element.dataset.testid ?? '',
      visible: Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
    }))
    return { allTestIds, interactives }
  }, interactiveSelector)

  const duplicates = snapshot.allTestIds.filter(
    (testId, index, values) => testId && values.indexOf(testId) !== index
  )
  expect(duplicates, `duplicate data-testid values: ${duplicates.join(', ')}`).toEqual([])

  const missing = snapshot.interactives.filter(({ testId }) => !testId)
  expect(
    missing,
    `interactive nodes without data-testid: ${missing.map(({ tag, label }) => `<${tag}> ${label}`).join(', ')}`
  ).toEqual([])

  const matchers = contracts.map((contract) => ({
    contract,
    matcher: targetMatcher(contract.target)
  }))
  const unregistered = snapshot.interactives
    .map(({ testId }) => testId)
    .filter((testId) => !matchers.some(({ matcher }) => matcher.test(testId)))
  expect(unregistered, `unregistered interaction ids: ${unregistered.join(', ')}`).toEqual([])

  for (const { testId, visible } of snapshot.interactives.filter((element) => element.visible)) {
    expect(visible).toBe(true)
    await expect(page.getByTestId(testId), `${testId} should be visible and unique`).toBeVisible()
  }

  for (const target of expectedVisualTargets) {
    const contract = contracts.find((entry) => entry.target === target)
    expect(contract?.coverage, `${target} must be a visual-only contract`).toBe('visual-only')
    expect(target.includes(':'), `${target} cannot be asserted without stable runtime parameters`).toBe(false)
    await expect(page.getByTestId(target), `${target} should render once and be visible`).toBeVisible()
  }

  return {
    interactiveIds: snapshot.interactives.map(({ testId }) => testId),
    renderedTargets: matchers
      .filter(({ matcher }) => snapshot.allTestIds.some((testId) => matcher.test(testId)))
      .map(({ contract }) => contract.target)
  }
}
