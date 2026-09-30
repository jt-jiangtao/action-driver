import { memo } from 'react'
import type { ModelRef } from '@action-driver/contracts'
import { AgentComposer } from './AgentComposer'
import type { ModelSelectionProjection } from '../models/model-selection'

type TaskComposerProps = {
  running: boolean
  disabled: boolean
  menuCloseKey: string
  modelSelection: ModelSelectionProjection
  onSelectModel(model: ModelRef): void
  onSubmit(goal: string): Promise<unknown> | void
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
  onSubmit,
  onInterrupt,
  width
}: TaskComposerProps) {
  return (
    <AgentComposer
      running={running}
      disabled={disabled}
      menuCloseKey={menuCloseKey}
      modelSelection={modelSelection}
      onSelectModel={onSelectModel}
      onSubmit={onSubmit}
      width={width}
      {...(onInterrupt ? { onInterrupt } : {})}
    />
  )
})
