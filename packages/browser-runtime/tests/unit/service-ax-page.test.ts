// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { selectAxTextPage, setAxValuePage } from '../../src/service-ax-page'
import { originalDocumentation } from '../original-service'

test('native text value setter and input/change events match AX page action', async () => {
  const baseline = await originalDocumentation()
  for (const fn of [setAxValuePage, baseline.baselineAxSetValuePage]) {
    const input = document.createElement('input')
    document.body.append(input)
    const events: string[] = []
    input.addEventListener('input', () => events.push('input'))
    input.addEventListener('change', () => events.push('change'))
    expect(fn.call(input, { value: 'hello' })).toBe('done')
    expect(input.value).toBe('hello')
    expect(events).toEqual(['input', 'change'])
    input.remove()
  }
})

test('checkbox values and tab activation requirements match original', async () => {
  const baseline = await originalDocumentation()
  for (const fn of [setAxValuePage, baseline.baselineAxSetValuePage]) {
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'; document.body.append(checkbox)
    expect(fn.call(checkbox, { value: 'true' })).toBe('done')
    expect(checkbox.checked).toBe(true)
    expect(() => fn.call(checkbox, { value: 'yes' })).toThrow('Checkbox value must be 0, 1, false, or true')
    checkbox.remove()
    const tab = document.createElement('button'); tab.setAttribute('role', 'tab'); document.body.append(tab)
    expect(fn.call(tab, { value: 'true' })).toBe('needs-click')
    tab.setAttribute('aria-selected', 'true')
    expect(fn.call(tab, { value: 'true' })).toBe('done')
    tab.remove()
  }
})

test('text selection disambiguates with context and supports cursor placement', async () => {
  const baseline = await originalDocumentation()
  for (const fn of [selectAxTextPage, baseline.baselineAxSelectTextPage]) {
    const input = document.createElement('input'); input.value = 'Ada Lovelace and Ada'; document.body.append(input)
    expect(() => fn.call(input, { text: 'Ada', selectionType: 'text' })).toThrow('Text to select matches multiple locations')
    fn.call(input, { text: 'Ada', suffix: ' Lovelace', selectionType: 'cursor_after' })
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 3])
    input.remove()
  }
})
