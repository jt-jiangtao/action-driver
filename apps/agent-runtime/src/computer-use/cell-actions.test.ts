import { describe, expect, it } from 'vitest'
import { classifyCellActions } from './cell-actions'

describe('cell action classification', () => {
  it('treats observation-only cells as read-only', () => {
    expect(classifyCellActions('const state = await sky.get_app_state({ app: "TextEdit" });\nnodeRepl.write(state.text);'))
      .toEqual({ acts: false, methods: [] })
    expect(classifyCellActions('await sky.list_apps()')).toEqual({ acts: false, methods: [] })
    expect(classifyCellActions('await sky.scroll({ app: "TextEdit", direction: "down" })'))
      .toEqual({ acts: false, methods: [] })
  })

  it('detects the methods that change the desktop', () => {
    expect(classifyCellActions('await sky.click({ app: "TextEdit", element_index: 2 })'))
      .toEqual({ acts: true, methods: ['click'] })
    expect(classifyCellActions(
      'const { sky } = await import("@oai/sky");\n' +
      'await sky.set_value({ app: "a", element_index: 1, value: "x" });\n' +
      'await sky.press_key({ app: "a", key: "Return" });'
    )).toEqual({ acts: true, methods: ['press_key', 'set_value'] })
  })

  it('ignores names that only appear in text', () => {
    expect(classifyCellActions('nodeRepl.write("press the click button")'))
      .toEqual({ acts: false, methods: [] })
    expect(classifyCellActions('// click it later\nconst note = `type_text`'))
      .toEqual({ acts: false, methods: [] })
    expect(classifyCellActions('const label = { click: "no" }.click'))
      .toEqual({ acts: true, methods: ['click'] })
  })

  it('reports a name built at runtime as read-only, which the sky layer then refuses', () => {
    expect(classifyCellActions('await sky["cli" + "ck"]({ app: "a", element_index: 1 })'))
      .toEqual({ acts: false, methods: [] })
  })
})
