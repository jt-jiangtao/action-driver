import type { Window, Direction, MouseButton, Point, SkyClient, Options } from '../src/index.js'
import type * as Original from '../../../apps/agent-runtime/vendor/codex-cua/@oai/sky/dist/project/cua/sky_js/src/types/window/index.js'
import type { Direction as OriginalDirection } from '../../../apps/agent-runtime/vendor/codex-cua/@oai/sky/dist/project/cua/sky_js/src/types/Direction.js'
import type { MouseButton as OriginalMouse } from '../../../apps/agent-runtime/vendor/codex-cua/@oai/sky/dist/project/cua/sky_js/src/types/MouseButton.js'
import type { Point as OriginalPoint } from '../../../apps/agent-runtime/vendor/codex-cua/@oai/sky/dist/project/cua/sky_js/src/types/Point.js'
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
export type Checks = [
  Assert<Window.Client extends Original.Client ? true : false>,
  Assert<Original.Client extends Window.Client ? true : false>,
  Assert<Same<Window.AppState, Original.AppState>>,
  Assert<Same<Window.Audio, Original.Audio>>,
  Assert<Same<Window.Options, Original.Options>>,
  Assert<Same<Direction, OriginalDirection>>,
  Assert<Same<MouseButton, OriginalMouse>>,
  Assert<Same<Point, OriginalPoint>>,
  Assert<SkyClient extends Original.Client ? true : false>,
  Assert<Same<Options, Original.Options>>
]
declare const client: SkyClient
client.click({ app: 'app', mouse_button: 'l' })
// @ts-expect-error wrong mouse button
client.click({ app: 'app', mouse_button: 'invalid' })
// @ts-expect-error required paste format
client.paste({ app: 'app', text: 'text' })
// @ts-expect-error unsupported platform
const unsupported: Options = { target: 'windows' }
void unsupported
import { env } from '../src/core/env.js'
const typedOption: 'on' | 'off' = env({ name: 'TEST', options: ['on', 'off'], default: 'on' }).get()
// @ts-expect-error invalid default outside options
const badOption = env({ name: 'TEST', options: ['on', 'off'], default: 'other' })
void [typedOption, badOption]
