// @vitest-environment node
import { expect, test } from 'vitest'
import { loadInstructions } from '../../src/instructions'
import { originalInstructions } from '../original-instructions'
test('macOS instructions match baseline across browser environments', async () => {
  const reference = await originalInstructions()
  for (const environment of [undefined, 'codex-app', 'training', 'cloud', 'orbit', 'other']) {
    const expected = reference.load_instructions('darwin', environment)
    const actual = loadInstructions('darwin', environment)
    expect({
      ...actual,
      browser_disabled: actual.browserDisabled,
      computer_disabled: actual.computerDisabled,
      browserDisabled: undefined,
      computerDisabled: undefined
    }).toEqual({ ...expected, browserDisabled: undefined, computerDisabled: undefined })
  }
})
test('unsupported platform fails instead of silently selecting documents', () => {
  for (const platform of ['linux', 'win32', 'freebsd'])
    expect(() => loadInstructions(platform)).toThrow(`unsupported cua_repl platform=${platform}`)
})
