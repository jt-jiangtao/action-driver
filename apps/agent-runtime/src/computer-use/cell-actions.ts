import { tokenize } from '../../resources/js-repl/bindings.mjs'

/**
 * Methods that change the desktop, so the `js` call has to be confirmed before it runs.
 *
 * The list matches the rule the `computer_act` tool already uses: waiting and scrolling never ask,
 * everything else does. Reads (`list_apps`, `get_app_state`) obviously do not.
 */
export const CONSEQUENTIAL_SKY_METHODS = [
  'click', 'drag', 'paste', 'press_key', 'select_text', 'set_value', 'type_text',
  'perform_secondary_action'
] as const

export type CellActions = {
  /** True when the cell mentions a method that can change the desktop. */
  acts: boolean
  /** The method names that made it look like an acting cell, in source order. */
  methods: string[]
}

/**
 * Decides whether one JavaScript cell may act, by looking for the method names in code positions.
 *
 * The same tokenizer the child runs with is reused here, so strings, comments, templates and
 * regular expressions cannot fake or hide a name by accident. The check is deliberately
 * conservative in one direction: an unknown shape counts as "may act" only when a name is present,
 * and a name built at runtime (`sky["cli" + "ck"]`) is not detected at all — that case is caught by
 * the sky layer itself, which refuses an action the call was not approved for.
 */
export function classifyCellActions(code: string): CellActions {
  const methods = new Set<string>()
  for (const token of tokenize(code)) {
    if (token.type !== 'word') continue
    if ((CONSEQUENTIAL_SKY_METHODS as readonly string[]).includes(token.value)) {
      methods.add(token.value)
    }
  }
  const ordered = (CONSEQUENTIAL_SKY_METHODS as readonly string[])
    .filter((method) => methods.has(method))
  return { acts: ordered.length > 0, methods: ordered }
}
