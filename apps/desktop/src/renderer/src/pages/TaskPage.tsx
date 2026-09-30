import type {
  AppApprovalDecision,
  AppApprovalRequest,
  AgentMessageProjection,
  PriorActivityTurnProjection,
  TaskProjection
} from '@action-driver/contracts'
import { Fragment, memo, useEffect, useMemo, useState } from 'react'
import { TaskComposer } from '../components/TaskComposer'
import type { TaskLayoutMode } from '../components/BrowserPanel'
import { BrowserPanel } from '../components/BrowserPanel'
import { ConversationMessages, TaskHeader } from '../components/Conversation'
import { ConversationViewport } from '../components/ConversationViewport'
import { ActivityTimeline } from '../components/ActivityTimeline'
import type { ModelSelectionProjection } from '../models/model-selection'
import type { ModelRef } from '@action-driver/contracts'
import type { ImageReader } from '../components/agent/ConversationImage'
import { TaskOutputFiles, type OutputFileReader } from '../components/agent/TaskOutputFiles'
import { activityOwnedText, dedupeAssistantText } from '../components/agent/activity-mirror'
import { selectActivityItems, type ActivityViewItem } from '../models/transcript'
import { useTaskView } from '../models/task-view'

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
  onAppDecision,
  onInterrupt,
  readImage,
  readOutputFile,
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
  onAppDecision?(requestId: string, decision: AppApprovalDecision): Promise<unknown> | void
  onInterrupt(): void
  readImage?: ImageReader | undefined
  readOutputFile?: OutputFileReader | undefined
  onSubmit(goal: string): Promise<unknown> | void
}) {
  const hasBrowser = task.browser !== null
  const hasComputer = (task.tools ?? []).some((tool) => tool.toolId === 'tools/local/cua/js')
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
  // Every "who renders what" decision lives in the selector; the page only maps
  // the resulting entries to components.
  const entries = useTaskView(task)
  const followKey = `${task.id}:${task.status}:${latestMessage?.id ?? ''}:${latestMessage?.content.length ?? 0}:${latestMessage?.parts?.length ?? 0}`
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
        {hasComputer && !hasBrowser && (
          <div className="computer-task-controls" aria-label="Computer Use 控制">
            {task.status === 'paused' ? (
              <button
                type="button"
                data-testid="e2e/tasks/detail/computer/resume#button"
                onClick={() => {
                  void onResume()
                }}
              >
                继续 Agent
              </button>
            ) : (
              <button
                type="button"
                data-testid="e2e/tasks/detail/computer/pause#button"
                onClick={() => {
                  void onPause()
                }}
              >
                暂停
              </button>
            )}
            <button
              type="button"
              data-testid="e2e/tasks/detail/computer/take-over#button"
              onClick={() => {
                void onTakeOver()
              }}
            >
              人工接管
            </button>
          </div>
        )}
        <div className="conversation-body">
          <ConversationViewport followKey={followKey}>
            <div className="conversation-stream" data-width={flowWidth}>
              {entries.map((entry) => {
                switch (entry.kind) {
                  case 'turn':
                    return (
                      <PriorTurn
                        key={entry.key}
                        user={entry.turn.user}
                        replies={entry.turn.replies}
                        activity={entry.turn.activity}
                        readImage={readImage}
                        readOutputFile={readOutputFile}
                      />
                    )
                  case 'user':
                    return (
                      <ConversationMessages
                        key={entry.key}
                        messages={[entry.message]}
                        readImage={readImage}
                      />
                    )
                  case 'activity':
                    return (
                      <ActivityTimeline
                        key={entry.key}
                        task={task}
                        items={entry.items}
                        readImage={readImage}
                      />
                    )
                  case 'approval':
                    return (
                      <AppApprovalCard
                        key={entry.key}
                        request={entry.request}
                        onDecision={onAppDecision}
                      />
                    )
                  case 'assistant':
                    return (
                      <ConversationMessages
                        key={entry.key}
                        messages={[entry.message]}
                        tools={entry.tools}
                        readImage={readImage}
                      />
                    )
                  case 'output-files':
                    return (
                      <TaskOutputFiles
                        key={entry.key}
                        files={entry.files}
                        readOutputFile={readOutputFile}
                      />
                    )
                  case 'failure':
                    return (
                      <div key={entry.key} className="agent-failure" role="alert">
                        <strong>任务执行失败</strong>
                        <span>{entry.detail}</span>
                      </div>
                    )
                }
              })}
            </div>
          </ConversationViewport>
          <TaskComposer
            key={task.id}
            running={task.status === 'running'}
            disabled={task.status !== 'running' && inheritedModelUnavailable}
            menuCloseKey={mode}
            modelSelection={modelSelection}
            onSelectModel={onSelectModel}
            onSubmit={onSubmit}
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
              taskId={task.id}
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

type PriorTurnProps = {
  user: AgentMessageProjection
  replies: AgentMessageProjection[]
  activity: PriorActivityTurnProjection | undefined
  readImage: ImageReader | undefined
  readOutputFile: OutputFileReader | undefined
}

/**
 * One finished turn above the current one. Its messages keep their references while the current
 * turn streams, so the turn renders once and is skipped for every later delta.
 */
const PriorTurn = memo(function PriorTurn({
  user,
  replies,
  activity,
  readImage,
  readOutputFile
}: PriorTurnProps) {
  const activityTask = useMemo(
    () =>
      activity
        ? {
            id: activity.taskId,
            status: 'succeeded' as const,
            activityDurationMs: activity.durationMs,
            activities: activity.activities,
            activityTimeline: activity.activityTimeline,
            // The turn's own messages decide whether its groups are anchored in the transcript.
            messages: replies,
            tools: activity.tools
          }
        : null,
    [activity, replies]
  )
  const userMessages = useMemo(() => [user], [user])
  const visibleReplies = useMemo(() => {
    const activityText = activityTask ? activityOwnedText(activityTask) : ''
    return replies.map((message) => dedupeAssistantText(message, activityText))
  }, [activityTask, replies])
  const activityItems = useMemo(
    () => (activityTask ? selectActivityItems(activityTask) : NO_ACTIVITY_ITEMS),
    [activityTask]
  )
  return (
    <Fragment>
      <ConversationMessages messages={userMessages} readImage={readImage} />
      {activityTask ? (
        <ActivityTimeline task={activityTask} items={activityItems} readImage={readImage} />
      ) : null}
      <ConversationMessages
        messages={visibleReplies}
        tools={activity?.tools ?? NO_TOOLS}
        readImage={readImage}
      />
      <TaskOutputFiles files={activity?.outputFiles ?? NO_FILES} readOutputFile={readOutputFile} />
    </Fragment>
  )
}, samePriorTurn)

const NO_TOOLS: NonNullable<TaskProjection['tools']> = []
const NO_FILES: NonNullable<TaskProjection['outputFiles']> = []
const NO_ACTIVITY_ITEMS: ActivityViewItem[] = []

/** Replies are regrouped on every render, so they compare by their messages, not the array. */
function samePriorTurn(previous: PriorTurnProps, next: PriorTurnProps): boolean {
  return (
    previous.user === next.user &&
    previous.activity === next.activity &&
    previous.readImage === next.readImage &&
    previous.readOutputFile === next.readOutputFile &&
    previous.replies.length === next.replies.length &&
    previous.replies.every((message, index) => message === next.replies[index])
  )
}

function AppApprovalCard({
  request,
  onDecision
}: {
  request: AppApprovalRequest
  onDecision:
    | ((requestId: string, decision: AppApprovalDecision) => Promise<unknown> | void)
    | undefined
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [icon, setIcon] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.productDesktop?.computerUse
      ?.getAppIcon(request.target.appPath)
      .then((value) => {
        if (!cancelled) setIcon(value ?? null)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [request.target.appPath])
  async function decide(decision: AppApprovalDecision) {
    if (pending || !onDecision) return
    setPending(true)
    setError(null)
    try {
      await onDecision(request.requestId, decision)
      // Keep disabled until the resolved event removes this request.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setPending(false)
    }
  }
  return (
    <section className="app-approval" aria-label={`${request.target.displayName} 应用授权`}>
      <h2>
        {icon ? (
          <img className="app-approval-icon" src={icon} alt="" aria-hidden="true" />
        ) : (
          <span aria-hidden="true">▣</span>
        )}
        <span>{request.target.displayName}</span>
      </h2>
      <p>{request.target.warningSubtitle ?? '允许读取和操作此应用？'}</p>
      {error && <p role="alert">{error}</p>}
      <div className="app-approval-actions">
        <button
          type="button"
          data-testid="e2e/tasks/detail/computer/app-approval-deny#button"
          disabled={pending || !onDecision}
          onClick={() => {
            void decide('deny')
          }}
        >
          拒绝
        </button>
        <button
          type="button"
          data-testid="e2e/tasks/detail/computer/app-approval-once#button"
          disabled={pending || !onDecision}
          onClick={() => {
            void decide('once')
          }}
        >
          仅本次
        </button>
        <button
          type="button"
          data-testid="e2e/tasks/detail/computer/app-approval-session#button"
          disabled={pending || !onDecision}
          onClick={() => {
            void decide('session')
          }}
        >
          本会话
        </button>
        {request.allowPersistentApproval && (
          <button
            type="button"
            data-testid="e2e/tasks/detail/computer/app-approval-always#button"
            disabled={pending || !onDecision}
            onClick={() => {
              void decide('always')
            }}
          >
            始终允许
          </button>
        )}
      </div>
    </section>
  )
}
