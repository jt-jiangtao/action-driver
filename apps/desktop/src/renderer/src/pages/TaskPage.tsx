import type { AgentMessageProjection, TaskProjection } from '@actiondriver/contracts'
import { Fragment } from 'react'
import { AgentComposer } from '../components/AgentComposer'
import type { TaskLayoutMode } from '../components/BrowserPanel'
import { BrowserPanel } from '../components/BrowserPanel'
import { ConversationMessages, TaskHeader } from '../components/Conversation'
import { ConversationViewport } from '../components/ConversationViewport'
import { ActivityTimeline } from '../components/ActivityTimeline'
import type { ModelSelectionProjection } from '../models/model-selection'
import type { ModelRef } from '@actiondriver/contracts'

export function TaskPage({
  mode,
  task,
  sidebarCollapsed = false,
  onExpandSidebar,
  modelSelection,
  onSelectModel,
  onModeChange,
  onPause,
  onResume,
  onTakeOver,
  onInterrupt,
  onSubmit
}: {
  mode: TaskLayoutMode
  task: TaskProjection
  sidebarCollapsed?: boolean
  onExpandSidebar?: (() => void) | undefined
  modelSelection: ModelSelectionProjection
  onSelectModel(model: ModelRef): void
  onModeChange(mode: TaskLayoutMode): void
  onPause(): Promise<unknown> | void
  onResume(): Promise<unknown> | void
  onTakeOver(): Promise<unknown> | void
  onInterrupt(): void
  onSubmit(goal: string): Promise<unknown> | void
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
  let currentUserIndex = -1
  for (let index = task.messages.length - 1; index >= 0; index -= 1) {
    if (task.messages[index]?.role === 'user') {
      currentUserIndex = index
      break
    }
  }
  const precedingMessages = task.messages.slice(0, Math.max(0, currentUserIndex))
  const precedingTurns: Array<{ user: AgentMessageProjection; replies: AgentMessageProjection[] }> =
    []
  for (const message of precedingMessages) {
    if (message.role === 'user') precedingTurns.push({ user: message, replies: [] })
    else precedingTurns.at(-1)?.replies.push(message)
  }
  const priorActivityByUserId = new Map(
    (task.priorActivityTurns ?? []).map((turn) => [turn.userMessageId, turn])
  )
  const processMessages = currentUserIndex < 0 ? [] : [task.messages[currentUserIndex]!]
  const assistantMessages =
    task.status === 'succeeded' || task.status === 'running'
      ? task.messages.slice(currentUserIndex + 1).filter((message) => message.role === 'agent')
      : []
  const hasTimelineText = task.activityTimeline?.some((item) => item.kind === 'text') ?? false
  const visibleAssistantMessages =
    task.status === 'running' &&
    (hasTimelineText || assistantMessages.every((message) => message.content.length === 0))
      ? []
      : assistantMessages
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
          sidebarCollapsed={sidebarCollapsed && agentWidth !== 0}
          onExpandSidebar={onExpandSidebar}
          browserCollapsed={hasBrowser && mode === 'browser-collapsed'}
          onExpandBrowser={() => onModeChange('split')}
        />
        <div className="conversation-body">
          <ConversationViewport followKey={followKey}>
            <div className="conversation-stream" data-width={flowWidth}>
              {precedingTurns.map((turn) => {
                const activity = priorActivityByUserId.get(turn.user.id)
                return (
                  <Fragment key={turn.user.id}>
                    <ConversationMessages messages={[turn.user]} generating={false} />
                    {activity ? (
                      <ActivityTimeline
                        task={{
                          ...task,
                          id: activity.taskId,
                          status: 'succeeded',
                          activityDurationMs: activity.durationMs,
                          activities: activity.activities,
                          activityTimeline: activity.activityTimeline,
                          tools: activity.tools
                        }}
                      />
                    ) : null}
                    <ConversationMessages messages={turn.replies} generating={false} />
                  </Fragment>
                )
              })}
              <ConversationMessages messages={processMessages} generating={false} />
              <ActivityTimeline task={task} />
              {visibleAssistantMessages.length > 0 ? (
                <ConversationMessages
                  messages={visibleAssistantMessages}
                  generating={task.status === 'running'}
                />
              ) : null}
            </div>
          </ConversationViewport>
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
              sidebarCollapsed={sidebarCollapsed}
              onExpandSidebar={onExpandSidebar}
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
