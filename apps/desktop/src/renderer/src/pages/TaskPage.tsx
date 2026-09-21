import type { TaskProjection } from '@actiondriver/contracts'
import { AgentComposer } from '../components/AgentComposer'
import type { TaskLayoutMode } from '../components/BrowserPanel'
import { BrowserPanel } from '../components/BrowserPanel'
import { ConversationMessages, TaskHeader } from '../components/Conversation'
import { ExecutionTimeline } from '../components/ExecutionTimeline'
import type { ModelSelectionProjection } from '../models/model-selection'

export function TaskPage({
  mode,
  task,
  modelSelection,
  onSelectModel,
  onModeChange,
  onPause,
  onResume,
  onTakeOver,
  onInterrupt
}: {
  mode: TaskLayoutMode
  task: TaskProjection
  modelSelection: ModelSelectionProjection
  onSelectModel(modelId: string): void
  onModeChange(mode: TaskLayoutMode): void
  onPause(): Promise<unknown> | void
  onResume(): Promise<unknown> | void
  onTakeOver(): Promise<unknown> | void
  onInterrupt(): void
}) {
  const agentWidth = mode === 'split' ? 536 : mode === 'browser-collapsed' ? 1192 : 0
  const browserWidth = mode === 'split' ? 656 : mode === 'browser-expanded' ? 1192 : 0
  const flowWidth = mode === 'browser-collapsed' ? 720 : 480
  return (
    <main
      className="task-page"
      data-testid="e2e/tasks/detail/page#page"
      data-mode={mode}
      data-task-id={task.id}
    >
      <section
        className={`agent-panel ${agentWidth === 0 ? 'is-hidden' : ''}`}
        data-testid="e2e/tasks/detail/agent#section"
        data-width={agentWidth}
      >
        <TaskHeader
          title={task.title}
          browserCollapsed={mode === 'browser-collapsed'}
          onExpandBrowser={() => onModeChange('split')}
        />
        <div className="conversation-body">
          <div className="conversation-stream" data-width={flowWidth}>
            <ConversationMessages messages={task.messages} />
            <ExecutionTimeline steps={task.steps} />
          </div>
          <div className="conversation-spacer" />
          <AgentComposer
            key={task.id}
            running={task.status === 'running'}
            disabled={task.status !== 'running'}
            menuCloseKey={mode}
            modelSelection={modelSelection}
            onSelectModel={onSelectModel}
            onSubmit={() => undefined}
            onInterrupt={onInterrupt}
            width={flowWidth}
          />
        </div>
      </section>
      <section
        className={`browser-panel-slot ${browserWidth === 0 ? 'is-hidden' : ''}`}
        data-testid="e2e/tasks/detail/browser#section"
        data-width={browserWidth}
      >
        {task.browser ? (
          <BrowserPanel
            mode={mode === 'browser-expanded' ? 'browser-expanded' : 'split'}
            projection={task.browser}
            onModeChange={onModeChange}
            onPause={onPause}
            onResume={onResume}
            onTakeOver={onTakeOver}
          />
        ) : null}
      </section>
    </main>
  )
}
