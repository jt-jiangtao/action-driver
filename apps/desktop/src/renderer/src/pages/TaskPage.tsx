import type { TaskProjection } from '@actiondriver/contracts'
import { AgentComposer } from '../components/AgentComposer'
import type { TaskLayoutMode } from '../components/BrowserPanel'
import { BrowserPanel } from '../components/BrowserPanel'
import { ConversationMessages, TaskHeader } from '../components/Conversation'
import { ConversationViewport } from '../components/ConversationViewport'
import { ToolActivityCards } from '../components/ToolActivityCards'
import { ActivityTimeline } from '../components/ActivityTimeline'
import { ToolApprovalBar } from '../components/ToolApprovalBar'
import type { ModelSelectionProjection } from '../models/model-selection'
import type { ModelRef } from '@actiondriver/contracts'

export function TaskPage({
  mode,
  task,
  modelSelection,
  onSelectModel,
  onModeChange,
  onPause,
  onResume,
  onTakeOver,
  onInterrupt,
  onSubmit,
  onApproveTool,
  onRejectTool
}: {
  mode: TaskLayoutMode
  task: TaskProjection
  modelSelection: ModelSelectionProjection
  onSelectModel(model: ModelRef): void
  onModeChange(mode: TaskLayoutMode): void
  onPause(): Promise<unknown> | void
  onResume(): Promise<unknown> | void
  onTakeOver(): Promise<unknown> | void
  onInterrupt(): void
  onSubmit(goal: string): Promise<unknown> | void
  onApproveTool?(callId: string, argumentsHash: string): Promise<void>
  onRejectTool?(callId: string, argumentsHash: string): Promise<void>
}) {
  const hasBrowser = task.browser !== null
  const pageMode = hasBrowser ? mode : 'agent-only'
  const agentWidth = !hasBrowser
    ? 1192
    : mode === 'split'
      ? 536
      : mode === 'browser-collapsed'
        ? 1192
        : 0
  const browserWidth = !hasBrowser
    ? 0
    : mode === 'split'
      ? 656
      : mode === 'browser-expanded'
        ? 1192
        : 0
  const flowWidth = !hasBrowser || mode === 'browser-collapsed' ? 720 : 480
  const inheritedModel = modelSelection.connections
    .flatMap((connection) => connection.models)
    .find(
      (model) =>
        model.ref.connectionId === task.model.connectionId &&
        model.ref.modelId === task.model.modelId
    )
  const inheritedModelUnavailable = !inheritedModel || inheritedModel.disabled
  const latestMessage = task.messages.at(-1)
  const archived = task.activityTimeline !== undefined && task.status !== 'running'
  const processMessages = archived
    ? task.messages.filter((message) => message.role === 'user')
    : task.messages
  const conclusionMessages = archived
    ? task.messages.filter((message) => message.role === 'agent')
    : []
  const followKey = `${task.id}:${task.status}:${latestMessage?.id ?? ''}:${latestMessage?.content.length ?? 0}`
  return (
    <main
      className="task-page"
      data-testid="e2e/tasks/detail/page#page"
      data-mode={pageMode}
      data-task-id={task.id}
    >
      <section
        className={`agent-panel ${agentWidth === 0 ? 'is-hidden' : ''}`}
        data-testid="e2e/tasks/detail/agent#section"
        data-width={agentWidth}
      >
        <TaskHeader
          title={task.title}
          browserCollapsed={hasBrowser && mode === 'browser-collapsed'}
          onExpandBrowser={() => onModeChange('split')}
        />
        <div className="conversation-body">
          <ConversationViewport followKey={followKey}>
            <div className="conversation-stream" data-width={flowWidth}>
              <ConversationMessages
                messages={processMessages}
                generating={task.status === 'running'}
              />
              {task.activityTimeline ? (
                <ActivityTimeline task={task} />
              ) : (
                <ToolActivityCards
                  tools={task.tools ?? []}
                  {...(onApproveTool ? { onApprove: onApproveTool } : {})}
                  {...(onRejectTool ? { onReject: onRejectTool } : {})}
                />
              )}
              {conclusionMessages.length > 0 ? (
                <ConversationMessages messages={conclusionMessages} generating={false} />
              ) : null}
            </div>
          </ConversationViewport>
          {task.activityTimeline ? (
            <ToolApprovalBar
              tools={task.tools ?? []}
              {...(onApproveTool ? { onApprove: onApproveTool } : {})}
              {...(onRejectTool ? { onReject: onRejectTool } : {})}
            />
          ) : null}
          <AgentComposer
            key={task.id}
            running={task.status === 'running'}
            disabled={task.status !== 'running' && inheritedModelUnavailable}
            menuCloseKey={mode}
            modelSelection={modelSelection}
            onSelectModel={onSelectModel}
            onSubmit={(goal) => void onSubmit(goal)}
            onInterrupt={onInterrupt}
            width={flowWidth}
          />
        </div>
      </section>
      {hasBrowser ? (
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
      ) : null}
    </main>
  )
}
