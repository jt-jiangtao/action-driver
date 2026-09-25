import type { AgentMessageProjection, TaskProjection } from '@actiondriver/contracts'
import { Fragment, useState } from 'react'
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
  onComputerDecision,
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
  onComputerDecision?(approved: boolean, providerCallId: string): Promise<unknown> | void
  onInterrupt(): void
  readImage?: ImageReader | undefined
  readOutputFile?: OutputFileReader | undefined
  onSubmit(goal: string, attachments?: ComposerAttachments): Promise<unknown> | void
}) {
  const hasBrowser = task.browser !== null
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const hasComputer = (task.tools ?? []).some((tool) => tool.toolId.startsWith('computer.'))
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
    task.status === 'succeeded' || task.status === 'running' || task.status === 'paused' || task.status === 'failed'
      ? task.messages.slice(currentUserIndex + 1).filter((message) => message.role === 'agent')
      : []
  // Ordered turns keep every block in the transcript; the activity area only
  // takes over the narration the model wrote before its first tool group.
  // Transcripts stored before the order contract keep the mirrored layout, so
  // their message stays out of the activity area's way while running.
  const orderedTurn = isOrderedTranscript(task)
  const hasImageGallery = (task.tools ?? []).some(
    (tool) => tool.toolId === 'image.generate' && tool.imageCount
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
              {precedingTurns.map((turn) => {
                const activity = priorActivityByUserId.get(turn.user.id)
                const activityTask = activity
                  ? {
                      ...task,
                      id: activity.taskId,
                      status: 'succeeded' as const,
                      activityDurationMs: activity.durationMs,
                      activities: activity.activities,
                      activityTimeline: activity.activityTimeline,
                      // The turn's own messages decide whether its groups are
                      // anchored in the transcript.
                      messages: turn.replies,
                      tools: activity.tools
                    }
                  : null
                const activityText = activityTask ? activityOwnedText(activityTask) : ''
                return (
                  <Fragment key={turn.user.id}>
                    <ConversationMessages
                      messages={[turn.user]}
                      readImage={readImage}
                    />
                    {activityTask ? <ActivityTimeline task={activityTask} /> : null}
                    <ConversationMessages
                      messages={turn.replies.map((message) =>
                        dedupeAssistantText(message, activityText)
                      )}
                      tools={activity?.tools ?? []}
                      readImage={readImage}
                    />
                    <TaskOutputFiles
                      files={activity?.outputFiles ?? []}
                      readOutputFile={readOutputFile}
                    />
                  </Fragment>
                )
              })}
              <ConversationMessages
                messages={processMessages}
                readImage={readImage}
              />
              <ActivityTimeline task={task} />
              {task.status === 'waiting-user' && task.pendingComputerApproval &&
                <section className="computer-action-approval" aria-label="Computer Use 动作确认">
                  <h2>确认这一步桌面操作</h2>
                  <p>ActionDriver 将在当前应用执行以下动作。确认仅适用于这一次调用。</p>
                  <pre>{describeComputerAction(task.pendingComputerApproval.action)}</pre>
                  {approvalError && <p role="alert">{approvalError}</p>}
                  <div>
                    <button type="button" data-testid="e2e/tasks/detail/computer/approval-deny#button"
                      onClick={() => { void Promise.resolve(onComputerDecision?.(
                      false, task.pendingComputerApproval!.providerCallId)).catch((error: unknown) =>
                      setApprovalError(error instanceof Error ? error.message : String(error))) }}>拒绝</button>
                    <button type="button" data-testid="e2e/tasks/detail/computer/approval-approve#button"
                      onClick={() => { void Promise.resolve(onComputerDecision?.(
                      true, task.pendingComputerApproval!.providerCallId)).catch((error: unknown) =>
                      setApprovalError(error instanceof Error ? error.message : String(error))) }}>确认执行</button>
                  </div>
                </section>}
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

function describeComputerAction(action: Record<string, unknown>): string {
  switch (action.type) {
    case 'click': return `点击坐标 (${String(action.x)}, ${String(action.y)})`
    case 'click-element': return `点击界面元素 ${String(action.elementRef)}`
    case 'type': return `输入文本：${String(action.text)}`
    case 'key': return `按键：${[...(Array.isArray(action.modifiers) ? action.modifiers : []), action.key].join(' + ')}`
    default: return JSON.stringify(action)
  }
}
