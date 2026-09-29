import { memo, useCallback } from 'react'
import type { ModelRef } from '@actiondriver/contracts'
import { AgentComposer, type ComposerAttachments } from './AgentComposer'
import type { ModelSelectionProjection } from '../models/model-selection'

type TaskComposerProps = {
  running: boolean
  disabled: boolean
  menuCloseKey: string
  modelSelection: ModelSelectionProjection
  onSelectModel(model: ModelRef): void
  onOpenModelSettings?: (() => void) | undefined
  onSubmit(goal: string, attachments?: ComposerAttachments): Promise<unknown> | void
  onInterrupt?(): void
  width: 480 | 720
}

/**
 * The composer takes only primitives and stable callbacks, so the task page can
 * re-render on every streaming tick without re-rendering the editor: the props
 * compare equal, and the submit adapter is created here, not inline above.
 */
export const TaskComposer = memo(function TaskComposer({
  running,
  disabled,
  menuCloseKey,
  modelSelection,
  onSelectModel,
  onOpenModelSettings,
  onSubmit,
  onInterrupt,
  width
}: TaskComposerProps) {
  const submit = useCallback(
    (goal: string, attachments?: ComposerAttachments) =>
      attachments ? onSubmit(goal, attachments) : onSubmit(goal),
    [onSubmit]
  )
  return (
    <AgentComposer
      running={running}
      disabled={disabled}
      menuCloseKey={menuCloseKey}
      modelSelection={modelSelection}
      onSelectModel={onSelectModel}
      onSubmit={submit}
      width={width}
      {...(onOpenModelSettings ? { onOpenModelSettings } : {})}
      {...(onInterrupt ? { onInterrupt } : {})}
    />
  )
})
