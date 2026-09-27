import type {
  AppApprovalDecision,
  AppApprovalRequest,
  AgentMessageProjection,
  PriorActivityTurnProjection,
  TaskProjection
} from '@actiondriver/contracts'
import { Fragment, memo, useEffect, useMemo, useState } from 'react'
import { AgentComposer, type ComposerAttachments } from '../components/AgentComposer'
import type { TaskLayoutMode } from '../components/BrowserPanel'
import { BrowserPanel } from '../components/BrowserPanel'
import { ConversationMessages, TaskHeader } from '../components/Conversation'
import { ConversationViewport } from '../components/ConversationViewport'
import { ActivityTimeline } from '../components/ActivityTimeline'
import type { ModelSelectionProjection } from '../models/model-selection'
import type { ModelRef } from '@actiondriver/contracts'
import type { ImageReader } from '../components/agent/ConversationImage'
import { TaskOutputFiles, type OutputFileReader } from '../components/agent/TaskOutputFiles'
import {
  activityOwnedText,
  dedupeAssistantText,
  isOrderedTranscript
} from '../components/agent/activity-mirror'

export function TaskPage({
  mode,
  task,
  sidebarCollapsed = false,
  onExpandSidebar,
  modelSelection,
  onSelectModel,
  onOpenModelSettings,
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
  onOpenModelSettings?(): void
  onModeChange(mode: TaskLayoutMode): void
  onPause(): Promise<unknown> | void
  onResume(): Promise<unknown> | void
  onTakeOver(): Promise<unknown> | void
  onAppDecision?(requestId: string, decision: AppApprovalDecision): Promise<unknown> | void
  onInterrupt(): void
  readImage?: ImageReader | undefined
  readOutputFile?: OutputFileReader | undefined
  onSubmit(goal: string, attachments?: ComposerAttachments): Promise<unknown> | void
}) {
  const hasBrowser = task.browser !== null
  const hasComputer = (task.tools ?? []).some((tool) => (tool.toolId.startsWith('tools.local.computer-use.') || tool.toolId.startsWith('computer.')))
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
  const priorActivityByUserId = useMemo(
    () => new Map((task.priorActivityTurns ?? []).map((turn) => [turn.userMessageId, turn])),
    [task.priorActivityTurns]
  )
  const processMessages = currentUserIndex < 0 ? [] : [task.messages[currentUserIndex]!]
  const assistantMessages =
    task.status === 'succeeded' || task.status === 'running' || task.status === 'paused' || task.status === 'failed'
      ? task.messages.slice(currentUserIndex + 1).filter((message) => message.role === 'agent')
      : []
  // Ordered turns keep every block in the transcript; the activity area only
  // takes over the narration the model wrote before its first tool group.
  // Transcripts stored before the order contract keep the mirrored layout, so
  // their message stays out of the activity area's way while running.
  const orderedTurn = isOrderedTranscript(task)
  const hasImageGallery = (task.tools ?? []).some(
    (tool) => tool.toolId === 'tools.local.image-generation.generate' && tool.imageCount
  )
  const legacyHidden =
    !orderedTurn &&
    task.status === 'running' &&
    !hasImageGallery &&
    !assistantMessages.some((message) => message.parts?.some((part) => part.kind === 'image')) &&
    (task.activityTimeline?.some((item) => item.kind === 'text') ?? false)
  const activityText = legacyHidden ? '' : activityOwnedText(task)
  // The assistant message is the only place streamed prose renders, in the
  // order it streamed (text, image batch, image, text). Nothing reorders on
  // completion; only the earlier process narration folds into the archive.
  const renderedAssistantMessages =
    task.status === 'failed'
      ? assistantMessages.filter((message) => message.parts?.some((part) => part.kind !== 'text')).map((message) => ({
          ...message,
          content: '',
          parts: message.parts?.filter((part) => part.kind !== 'text') ?? []
        }))
      : legacyHidden
        ? []
        : assistantMessages.map((message) => dedupeAssistantText(message, activityText))
  // An empty turn renders nothing: the activity area already reports progress,
  // and an empty message would only add spacing or a second status line. Image
  // tools keep theirs, because the gallery placeholders live there.
  const visibleAssistantMessages = renderedAssistantMessages.filter(
    (message, index) =>
      message.content.length > 0 ||
      (message.parts?.length ?? 0) > 0 ||
      (hasImageGallery && index === renderedAssistantMessages.length - 1)
  )
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
        {hasComputer && !hasBrowser && <div className="computer-task-controls" aria-label="Computer Use 控制">
          {task.status === 'paused'
            ? <button type="button" data-testid="e2e/tasks/detail/computer/resume#button"
                onClick={() => { void onResume() }}>继续 Agent</button>
            : <button type="button" data-testid="e2e/tasks/detail/computer/pause#button"
                onClick={() => { void onPause() }}>暂停</button>}
          <button type="button" data-testid="e2e/tasks/detail/computer/take-over#button"
            onClick={() => { void onTakeOver() }}>人工接管</button>
        </div>}
        <div className="conversation-body">
          <ConversationViewport followKey={followKey}>
            <div className="conversation-stream" data-width={flowWidth}>
              {precedingTurns.map((turn) => (
                <PriorTurn
                  key={turn.user.id}
                  user={turn.user}
                  replies={turn.replies}
                  activity={priorActivityByUserId.get(turn.user.id)}
                  readImage={readImage}
                  readOutputFile={readOutputFile}
                />
              ))}
              <ConversationMessages
                messages={processMessages}
                readImage={readImage}
              />
              <ActivityTimeline task={task} readImage={readImage} />
              {(task.pendingAppApproval ?? []).map((request) => (
                <AppApprovalCard key={request.requestId} request={request} onDecision={onAppDecision} />
              ))}
              {visibleAssistantMessages.length > 0 ? (
                <ConversationMessages
                  messages={visibleAssistantMessages}
                  tools={task.tools ?? []}
                  readImage={readImage}
                />
              ) : null}
              <TaskOutputFiles files={task.outputFiles ?? []} readOutputFile={readOutputFile} />
              {task.status === 'failed' ? (
                <div className="agent-failure" role="alert">
                  <strong>任务执行失败</strong>
                  <span>
                    {task.steps.find((step) => step.state === 'failed')?.detail ?? '模型响应失败'}
                  </span>
                </div>
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
            onOpenModelSettings={onOpenModelSettings}
            onSubmit={(goal, attachments) =>
              attachments ? onSubmit(goal, attachments) : onSubmit(goal)
            }
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
  return (
    <Fragment>
      <ConversationMessages messages={userMessages} readImage={readImage} />
      {activityTask ? <ActivityTimeline task={activityTask} readImage={readImage} /> : null}
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

function AppApprovalCard({ request, onDecision }: {
  request: AppApprovalRequest
  onDecision: ((requestId: string, decision: AppApprovalDecision) => Promise<unknown> | void) | undefined
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [icon, setIcon] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.actionDriverDesktop?.computerUse?.getAppIcon(request.target.appPath)
      .then((value) => { if (!cancelled) setIcon(value ?? null) })
      .catch(() => undefined)
    return () => { cancelled = true }
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
        {icon
          ? <img className="app-approval-icon" src={icon} alt="" aria-hidden="true" />
          : <span aria-hidden="true">▣</span>}
        <span>{request.target.displayName}</span>
      </h2>
      <p>{request.target.warningSubtitle ?? '允许读取和操作此应用？'}</p>
      {error && <p role="alert">{error}</p>}
      <div className="app-approval-actions">
        <button type="button" data-testid="e2e/tasks/detail/computer/app-approval-deny#button"
          disabled={pending || !onDecision} onClick={() => { void decide('deny') }}>拒绝</button>
        <button type="button" data-testid="e2e/tasks/detail/computer/app-approval-once#button"
          disabled={pending || !onDecision} onClick={() => { void decide('once') }}>仅本次</button>
        <button type="button" data-testid="e2e/tasks/detail/computer/app-approval-session#button"
          disabled={pending || !onDecision} onClick={() => { void decide('session') }}>本会话</button>
        {request.allowPersistentApproval && (
          <button type="button" data-testid="e2e/tasks/detail/computer/app-approval-always#button"
            disabled={pending || !onDecision} onClick={() => { void decide('always') }}>始终允许</button>
        )}
      </div>
    </section>
  )
}
