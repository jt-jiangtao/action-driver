import { fileURLToPath } from 'node:url'
import { fromFilePath, toDataUrl } from '../core/bytes.js'
import type { MacComputerUseClient } from './client.js'
import { createComputerUsePolicy, type PolicyHost, type TelemetrySink } from './policy.js'
import { createComputerUseTelemetry } from './telemetry.js'
import { windowResult } from './window-result.js'
let lazyClient: Promise<MacComputerUseClient> | undefined
const defaultClient = () =>
  (lazyClient ??= import('./client.js').then((module) => new module.MacComputerUseClient()))
const defaultHost = () => (globalThis as typeof globalThis & { nodeRepl?: PolicyHost }).nodeRepl
const defaultTelemetry = createComputerUseTelemetry()
interface ComputerOptions {
  getClient?: () => Promise<MacComputerUseClient>
  getHost?: () => PolicyHost | undefined
  telemetry?: TelemetrySink
  enableAudio?: boolean
}
type AppInput = { app: string }
type Indexed = AppInput & { element_index: number }
type Positioned = AppInput & { element_index?: number; x?: number; y?: number }
export function createMacComputer(options: ComputerOptions = {}) {
  const getClient = options.getClient ?? defaultClient,
    getHost = options.getHost ?? defaultHost,
    telemetry = options.telemetry ?? defaultTelemetry
  const policy = createComputerUsePolicy({ getClient, getHost, telemetry }),
    delivered = new Set<string>()
  telemetry.clientCreated()
  const audio = {
    async start_audio_recording(input: { max_duration_ms?: number } = {}) {
      policy.setResponseMeta(null)
      return policy.withToolTelemetry('start_audio_recording', undefined, async () => {
        const duration = input.max_duration_ms ?? 60000
        if (!Number.isInteger(duration) || duration < 100 || duration > 300000)
          throw new Error('audio recording duration must be an integer from 100 through 300000')
        await policy.requestAudioApproval()
        await (await getClient()).startAudioRecording({ maxDurationMilliseconds: duration })
      })
    },
    async stop_audio_recording() {
      policy.setResponseMeta(null)
      return policy.withToolTelemetry('stop_audio_recording', undefined, async () => {
        const operation = async () => {
          const result = await (await getClient()).stopAudioRecording()
          if (typeof result.url !== 'string' || result.url.length === 0)
            throw new Error('computer-use service did not return a computer audio URL')
          const url = new URL(result.url)
          if (url.protocol !== 'file:')
            throw new Error('computer-use service did not return a local computer audio URL')
          const filepath = fileURLToPath(url),
            bytes = await fromFilePath(filepath)
          return { filepath, bytes, data_url: toDataUrl(bytes, 'audio/wav') }
        }
        const suspend = getHost()?.withSuspendedTimeout
        return typeof suspend === 'function' ? suspend(operation) : operation()
      })
    }
  }
  return {
    target: 'mac' as const,
    async list_apps() {
      policy.setResponseMeta(null)
      const apps = await policy.withToolTelemetry('list_apps', undefined, async () =>
        (await getClient()).listApps()
      )
      return apps.map((app) => ({
        id: app.bundleIdentifier ?? app.displayName ?? 'unknown',
        displayName: app.displayName,
        isRunning: app.isRunning,
        lastUsedDate: app.lastUsedDate ?? undefined,
        useCount: app.useCount ?? undefined
      }))
    },
    get_app_state(input: AppInput & { disableDiff?: boolean }) {
      return policy.withPolicy('get_app_state', input, async (approved) =>
        windowResult(
          approved.app,
          await (
            await getClient()
          ).getAppState({ app: approved.app, disableDiff: approved.disableDiff }),
          delivered
        )
      )
    },
    click(input: Positioned & { click_count?: number; mouse_button?: string | number }) {
      return policy.withPolicy('click', input, async (a) => {
        await (
          await getClient()
        ).click({
          app: a.app,
          clickCount: a.click_count,
          elementIndex: a.element_index,
          mouseButton: a.mouse_button,
          x: a.x,
          y: a.y
        })
      })
    },
    drag(input: AppInput & { from_x: number; from_y: number; to_x: number; to_y: number }) {
      return policy.withPolicy('drag', input, async (a) => {
        await (
          await getClient()
        ).drag({ app: a.app, fromX: a.from_x, fromY: a.from_y, toX: a.to_x, toY: a.to_y })
      })
    },
    paste(input: AppInput & { text: string; format: string }) {
      return policy.withPolicy('paste', input, async (a) => {
        await (await getClient()).paste({ app: a.app, text: a.text, format: a.format })
      })
    },
    press_key(input: AppInput & { key: string }) {
      return policy.withPolicy('press_key', input, async (a) => {
        await (await getClient()).pressKey({ app: a.app, key: a.key })
      })
    },
    scroll(input: Positioned & { direction: string; pages?: number }) {
      return policy.withPolicy('scroll', input, async (a) => {
        await (
          await getClient()
        ).scroll({
          app: a.app,
          direction: a.direction,
          elementIndex: a.element_index,
          pages: a.pages,
          x: a.x,
          y: a.y
        })
      })
    },
    select_text(
      input: Indexed & { text: string; prefix?: string; suffix?: string; selection_type?: string }
    ) {
      return policy.withPolicy('select_text', input, async (a) => {
        await (
          await getClient()
        ).selectText({
          app: a.app,
          elementIndex: a.element_index,
          text: a.text,
          prefix: a.prefix,
          suffix: a.suffix,
          selection: a.selection_type
        })
      })
    },
    set_value(input: Indexed & { value: string }) {
      return policy.withPolicy('set_value', input, async (a) => {
        await (
          await getClient()
        ).setValue({ app: a.app, elementIndex: a.element_index, value: a.value })
      })
    },
    type_text(input: AppInput & { text: string }) {
      return policy.withPolicy('type_text', input, async (a) => {
        await (await getClient()).typeText({ app: a.app, text: a.text })
      })
    },
    perform_secondary_action(input: Indexed & { action: string }) {
      return policy.withPolicy('perform_secondary_action', input, async (a) => {
        await (
          await getClient()
        ).performSecondaryAction({ app: a.app, elementIndex: a.element_index, action: a.action })
      })
    },
    ...((options.enableAudio ?? process.env.SKY_ENABLE_AUDIO === '1') ? audio : {})
  }
}
