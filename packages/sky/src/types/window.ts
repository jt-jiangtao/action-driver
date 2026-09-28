import type { Direction, MouseButton } from './index.js'
export type AppIdentifier = string
export type Screenshot = { url: string }
export type AppState = { app: AppIdentifier; screenshot: Screenshot | null; text: string }
export type Audio = { filepath: string; bytes: Uint8Array; data_url: string }
export type MacOptions = { target: 'mac' }
export type Options = MacOptions

type Target = { app: AppIdentifier }
type Position = { element_index?: number; x?: number; y?: number }
type Indexed = Target & { element_index: number }
export namespace Click {
  export type Input = Target & Position & { mouse_button?: MouseButton; click_count?: number }
  export type Return = Promise<void>
  export type Function = (input: Input) => Return
}
export namespace Drag {
  export type Input = Target & { from_x: number; from_y: number; to_x: number; to_y: number }
  export type Return = Promise<void>
  export type Function = (input: Input) => Return
}
export namespace GetAppState {
  export type Input = Target & { disableDiff?: boolean }
  export type Return = Promise<AppState>
  export type Function = (input: Input) => Return
}
export namespace ListApps {
  export type App = {
    id: string
    displayName?: string
    lastUsedDate?: string
    useCount?: number
    isRunning?: boolean
  }
  export type Input = never
  export type Return = Promise<App[]>
  export type Function = () => Return
}
export namespace Paste {
  export type Input = Target & { text: string; format: 'text' | 'md' | 'html' }
  export type Return = Promise<void>
  export type Function = (input: Input) => Return
}
export namespace PerformSecondaryAction {
  export type Input = Indexed & { action: string }
  export type Return = Promise<void>
  export type Function = (input: Input) => Return
}
export namespace PressKey {
  export type Input = Target & { key: string }
  export type Return = Promise<void>
  export type Function = (input: Input) => Return
}
export namespace Scroll {
  export type Input = Target & Position & { direction: Direction; pages?: number }
  export type Return = Promise<void>
  export type Function = (input: Input) => Return
}
export namespace SelectText {
  export type SelectionType = 'text' | 'cursor_before' | 'cursor_after'
  export type Input = Indexed & {
    text: string
    prefix?: string
    suffix?: string
    selection_type?: SelectionType
  }
  export type Return = Promise<void>
  export type Function = (input: Input) => Return
}
export namespace SetValue {
  export type Input = Indexed & { value: string }
  export type Return = Promise<void>
  export type Function = (input: Input) => Return
}
export namespace TypeText {
  export type Input = Target & { text: string }
  export type Return = Promise<void>
  export type Function = (input: Input) => Return
}
export namespace StartAudioRecording {
  export type Input = { max_duration_ms?: number }
  export type Return = Promise<void>
  export type Function = (input?: Input) => Return
}
export namespace StopAudioRecording {
  export type Input = never
  export type Return = Promise<Audio>
  export type Function = () => Return
}
export type Client = {
  target: 'mac'
  click: Click.Function
  drag: Drag.Function
  get_app_state: GetAppState.Function
  list_apps: ListApps.Function
  paste: Paste.Function
  perform_secondary_action: PerformSecondaryAction.Function
  press_key: PressKey.Function
  scroll: Scroll.Function
  select_text: SelectText.Function
  set_value: SetValue.Function
  type_text: TypeText.Function
  start_audio_recording?: StartAudioRecording.Function
  stop_audio_recording?: StopAudioRecording.Function
}
