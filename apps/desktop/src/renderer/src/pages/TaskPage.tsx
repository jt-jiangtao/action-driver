import type { TaskProjection } from '@actiondriver/contracts'
import { AgentComposer } from '../components/AgentComposer'
import type { TaskLayoutMode } from '../components/BrowserPanel'
import { BrowserPanel } from '../components/BrowserPanel'
import { ConversationMessages, TaskHeader } from '../components/Conversation'
import { ExecutionTimeline } from '../components/ExecutionTimeline'

export function TaskPage({
  mode,
  task,
  onModeChange,
  onPause,
  onResume,
  onTakeOver,
  onInterrupt
}: {
  mode: TaskLayoutMode
  task: TaskProjection
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
    <main className="task-page" data-testid="task-page" data-mode={mode}>
      <section
        className={`agent-panel ${agentWidth === 0 ? 'is-hidden' : ''}`}
        data-testid="agent-panel"
        data-width={agentWidth}
        style={{ width: agentWidth }}
      >
        {agentWidth > 0 ? (
          <>
            <TaskHeader
              title={task.title}
              browserCollapsed={mode === 'browser-collapsed'}
              onExpandBrowser={() => onModeChange('split')}
            />
            <div className="conversation-body">
              <div className="conversation-stream" style={{ width: flowWidth }}>
                <ConversationMessages messages={task.messages} />
                <ExecutionTimeline steps={task.steps} />
              </div>
              <div className="conversation-spacer" />
              <AgentComposer
                running={task.status === 'running'}
                disabled={task.status !== 'running'}
                onSubmit={() => undefined}
                onInterrupt={onInterrupt}
                width={flowWidth}
              />
            </div>
          </>
        ) : null}
      </section>
      <section
        className={`browser-panel-slot ${browserWidth === 0 ? 'is-hidden' : ''}`}
        data-testid="browser-panel-slot"
        data-width={browserWidth}
        style={{ width: browserWidth }}
      >
        {browserWidth > 0 && task.browser ? (
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
