import { readFileSync } from 'node:fs'
import { checkKeyboardFocus } from './service-input-guard.js'
import type { InputGuardCdp } from './service-input-guard.js'
import type { CdpOptions } from './service-cdp-attachment.js'
import type { CdpTarget } from './service-cdp-execution.js'
interface Key {
  key: string
  keyCode: number
  keyCodeWithoutLocation: number
  code: string
  text: string
  location: number
  shifted?: Key
}
const data = JSON.parse(
  readFileSync(new URL('../resources/browser-keyboard.json', import.meta.url), 'utf8')
) as {
  keys: [string, Key][]
  aliases: [string, string][]
  chords: [string, string[]][]
  macCommands: [string, string][]
}
const definitions = new Map(data.keys),
  aliases = new Map(data.aliases),
  chords = new Map(data.chords),
  macCommands = new Map(data.macCommands),
  modifierOrder = ['Shift', 'Control', 'Alt', 'Meta']
interface KeyboardCdp extends InputGuardCdp {
  platform: string
  call(
    id: number,
    method: string,
    params: Record<string, unknown>,
    options: CdpOptions
  ): Promise<unknown>
}
interface KeyboardOptions {
  inputTargetToken?: string
  deadlineMs?: number | undefined
  blockClosedShadowInput?: boolean
}
function splitKeys(value: string) {
  const keys: string[] = []
  let current = ''
  for (const character of value) {
    if (character === '+' && current) {
      keys.push(current)
      current = ''
    } else current += character
  }
  if (current) keys.push(current)
  return keys
}
function normalizedKeys(value: string | string[]) {
  const keys = Array.isArray(value) ? value.flatMap(splitKeys) : splitKeys(value),
    chord = chords.get(keys.map((key) => key.toLowerCase()).join('+'))
  return (
    chord ??
    keys.map((key) =>
      definitions.has(key) ? key : (aliases.get(key.toLowerCase().replaceAll('_', '')) ?? key)
    )
  )
}
const modifier = (key: string) =>
  ['Alt', 'Control', 'Meta', 'Shift'].includes(key) ? key : undefined
function definition(key: string, pressed: Set<string>) {
  const resolved = key === 'ControlOrMeta' ? 'Meta' : key,
    value = definitions.get(resolved)
  if (value === undefined) throw Error(`Unknown key: "${key}"`)
  return pressed.has('Shift') && value.shifted ? value.shifted : value
}
function bits(pressed: Set<string>) {
  let result = 0
  for (const key of pressed)
    result |=
      key === 'Alt' ? 1 : key === 'Control' ? 2 : key === 'Meta' ? 4 : key === 'Shift' ? 8 : 0
  return result
}
function blocked(code: string, pressed: Set<string>) {
  if (
    (code === 'KeyC' || code === 'KeyX') &&
    pressed.size === 2 &&
    pressed.has('Shift') &&
    (pressed.has('Meta') || pressed.has('Control'))
  )
    return false
  return (
    ((pressed.has('Meta') || pressed.has('Control')) && ['KeyC', 'KeyV', 'KeyX'].includes(code)) ||
    (code === 'Insert' && (pressed.has('Control') || pressed.has('Shift'))) ||
    (code === 'Delete' && pressed.has('Shift'))
  )
}
function shortcut(code: string, pressed: Set<string>) {
  if (pressed.size === 1) {
    if (code === 'Insert' && pressed.has('Control')) return 'copy'
    if (code === 'Insert' && pressed.has('Shift')) return 'paste'
    if (code === 'Delete' && pressed.has('Shift')) return 'cut'
  }
  const command =
      (pressed.has('Meta') || pressed.has('Control')) &&
      !(pressed.has('Meta') && pressed.has('Control')),
    plain = pressed.size === 1 || (pressed.size === 2 && pressed.has('Shift'))
  if (!command || !plain) return null
  return code === 'KeyC'
    ? pressed.has('Shift')
      ? null
      : 'copy'
    : code === 'KeyV'
      ? pressed.has('Shift')
        ? 'paste-plain-text'
        : 'paste'
      : code === 'KeyX'
        ? pressed.has('Shift')
          ? null
          : 'cut'
        : null
}
function clipboardAction(keys: string[]) {
  const pressed = new Set<string>(),
    codes: string[] = []
  let denied = false
  for (const key of keys) {
    const value = definition(key, pressed),
      mod = modifier(value.key)
    if (mod !== undefined) pressed.add(mod)
    else {
      codes.push(value.code)
      if (blocked(value.code, pressed)) denied = true
    }
  }
  const code = codes.length === 1 ? codes[0] : undefined
  if (code !== undefined) {
    const action = shortcut(code, pressed)
    if (action !== null) return action
    if (blocked(code, pressed)) return 'blocked'
  }
  return denied ? 'blocked' : null
}
export function clipboardShortcut(keys: string | string[]) {
  return clipboardAction(normalizedKeys(keys))
}
class KeyboardInput {
  private pressed = new Set<string>()
  constructor(
    private cdp: KeyboardCdp,
    private target: CdpTarget,
    private options: KeyboardOptions
  ) {}
  private params(params: Record<string, unknown>) {
    return this.options.inputTargetToken == null
      ? params
      : { ...params, __codexIabExpectedInputTargetToken: this.options.inputTargetToken }
  }
  private async dispatch(method: string, params: Record<string, unknown>) {
    if (this.target.sessionId == null && this.target.targetId == null)
      await this.cdp.call(this.target.tabId, method, this.params(params), {
        deadlineMs: this.options.deadlineMs
      })
    else
      await this.cdp.callTarget(this.target, method, this.params(params), {
        deadlineMs: this.options.deadlineMs
      })
  }
  async down(key: string) {
    const value = definition(key, this.pressed)
    if (this.options.blockClosedShadowInput === true)
      await checkKeyboardFocus(this.cdp, this.target.tabId, { deadlineMs: this.options.deadlineMs })
    const mod = modifier(value.key)
    if (mod !== undefined) this.pressed.add(mod)
    const text =
        this.pressed.size === 0 || (this.pressed.size === 1 && this.pressed.has('Shift'))
          ? value.text
          : '',
      command =
        value.code === 'KeyA' && this.pressed.size === 1 && this.pressed.has('Meta')
          ? 'selectAll'
          : macCommands.get(
              [...modifierOrder.filter((key) => this.pressed.has(key)), value.code].join('+')
            )
    await this.dispatch('Input.dispatchKeyEvent', {
      type: text ? 'keyDown' : 'rawKeyDown',
      modifiers: bits(this.pressed),
      windowsVirtualKeyCode: value.keyCodeWithoutLocation,
      code: value.code,
      ...(command ? { commands: [command] } : {}),
      key: value.key,
      text,
      unmodifiedText: text,
      location: value.location,
      isKeypad: value.location === 3
    })
  }
  async up(key: string) {
    const value = definition(key, this.pressed),
      mod = modifier(value.key)
    if (mod !== undefined) this.pressed.delete(mod)
    await this.dispatch('Input.dispatchKeyEvent', {
      type: 'keyUp',
      modifiers: bits(this.pressed),
      windowsVirtualKeyCode: value.keyCodeWithoutLocation,
      code: value.code,
      key: value.key,
      location: value.location,
      isKeypad: value.location === 3
    })
  }
  async insertText(text: string) {
    if (this.options.blockClosedShadowInput === true)
      await checkKeyboardFocus(this.cdp, this.target.tabId, { deadlineMs: this.options.deadlineMs })
    await this.dispatch('Input.insertText', { text })
  }
}
function input(cdp: KeyboardCdp, target: number | CdpTarget, options: KeyboardOptions) {
  if (cdp.platform !== 'darwin') throw Error('Browser keyboard input currently supports macOS only')
  return new KeyboardInput(cdp, typeof target === 'object' ? target : { tabId: target }, options)
}
export async function dispatchKeys(
  cdp: KeyboardCdp,
  target: number | CdpTarget,
  value: string | string[],
  options: KeyboardOptions = {}
) {
  const keyboard = input(cdp, target, options),
    keys = normalizedKeys(value),
    last = keys.at(-1)
  if (last === undefined) throw Error('keypress requires at least one key')
  if (clipboardAction(keys) !== null)
    throw Error(
      'Native clipboard shortcuts are disabled; use Browser Use virtual clipboard commands instead.'
    )
  if (options.blockClosedShadowInput !== true) {
    for (const key of keys.slice(0, -1)) await keyboard.down(key)
    await keyboard.down(last)
    await keyboard.up(last)
    for (const key of keys.slice(0, -1).reverse()) await keyboard.up(key)
    return
  }
  const pressed: string[] = []
  try {
    for (const key of keys) {
      await keyboard.down(key)
      pressed.push(key)
    }
  } finally {
    for (const key of pressed.reverse()) await keyboard.up(key)
  }
}
export async function dispatchCharacter(
  cdp: KeyboardCdp,
  target: number | CdpTarget,
  value: string,
  options: KeyboardOptions = {}
) {
  if (Array.from(value).length !== 1)
    throw Error('dispatchTextCharacter requires one Unicode character')
  const keyboard = input(cdp, target, options)
  if (!definitions.has(value)) {
    await keyboard.insertText(value)
    return
  }
  await keyboard.down(value)
  await keyboard.up(value)
}
