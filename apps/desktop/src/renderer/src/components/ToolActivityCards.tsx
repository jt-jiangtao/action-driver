import { useEffect, useState } from 'react'
import type { ToolInvocationProjection } from '@actiondriver/contracts'

type Decision = 'approve' | 'reject'

export function ToolActivityCards({
  tools,
  onApprove,
  onReject
}: {
  tools: readonly ToolInvocationProjection[]
  onApprove?(callId: string, argumentsHash: string): Promise<void>
  onReject?(callId: string, argumentsHash: string): Promise<void>
}) {
  const running = tools.filter((tool) => !isTerminal(tool.status))
  const completed = tools.filter((tool) => isTerminal(tool.status))
  const latestRunning = running.at(-1)?.callId ?? null
  const [openCallId, setOpenCallId] = useState<string | null>(latestRunning)

  useEffect(() => {
    setOpenCallId(latestRunning)
  }, [latestRunning])

  if (tools.length === 0) return null
  return (
    <div className="tool-activity-list" aria-label="工具活动">
      {running.length > 0 ? (
        <ToolActivityGroup
          testId="e2e/tasks/detail/tool-activity/running#section"
          title="正在运行中"
          tools={running}
          openCallId={openCallId}
          onToggle={setOpenCallId}
          {...(onApprove ? { onApprove } : {})}
          {...(onReject ? { onReject } : {})}
        />
      ) : null}
      {completed.length > 0 ? (
        <ToolActivityGroup
          testId="e2e/tasks/detail/tool-activity/completed#section"
          title="运行结束"
          tools={completed}
          openCallId={openCallId}
          onToggle={setOpenCallId}
          {...(onApprove ? { onApprove } : {})}
          {...(onReject ? { onReject } : {})}
        />
      ) : null}
    </div>
  )
}

function ToolActivityGroup({
  testId,
  title,
  tools,
  openCallId,
  onToggle,
  onApprove,
  onReject
}: {
  testId: string
  title: string
  tools: readonly ToolInvocationProjection[]
  openCallId: string | null
  onToggle(callId: string | null): void
  onApprove?(callId: string, argumentsHash: string): Promise<void>
  onReject?(callId: string, argumentsHash: string): Promise<void>
}) {
  return (
    <section className="tool-activity-group" data-testid={testId} aria-label={title}>
      <h2>{title}</h2>
      {tools.map((tool) => (
        <ToolActivityCard
          key={tool.callId}
          tool={tool}
          open={openCallId === tool.callId}
          onToggle={() => onToggle(openCallId === tool.callId ? null : tool.callId)}
          {...(onApprove ? { onApprove } : {})}
          {...(onReject ? { onReject } : {})}
        />
      ))}
    </section>
  )
}

function ToolActivityCard({
  tool,
  open,
  onToggle,
  onApprove,
  onReject
}: {
  tool: ToolInvocationProjection
  open: boolean
  onToggle(): void
  onApprove?(callId: string, argumentsHash: string): Promise<void>
  onReject?(callId: string, argumentsHash: string): Promise<void>
}) {
  const [pending, setPending] = useState<Decision | null>(null)
  const [error, setError] = useState<string | null>(null)
  const waiting = tool.status === 'waiting_approval'
  const detail = tool.resultSummary ?? tool.errorSummary ?? tool.summary
  const decide = async (decision: Decision) => {
    const action = decision === 'approve' ? onApprove : onReject
    if (!action || pending) return
    setPending(decision)
    setError(null)
    try {
      await action(tool.callId, tool.argumentsHash)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPending(null)
    }
  }
  return (
    <article className={`tool-activity-card is-${tool.status}`}>
      <button
        type="button"
        className="tool-activity-toggle"
        data-testid="e2e/tasks/detail/tool-activity/card-toggle#button"
        aria-expanded={open}
        aria-label={`${tool.toolId}：${toolStatusLabel(tool.status)}`}
        onClick={onToggle}
      >
        <span className="tool-activity-status" aria-hidden="true" />
        <span className="tool-activity-title">{tool.toolId}</span>
        <span className="tool-activity-state">{toolStatusLabel(tool.status)}</span>
        {tool.durationMs !== undefined ? <span className="tool-activity-duration">{formatDuration(tool.durationMs)}</span> : null}
        <span className="tool-activity-chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>
      {open ? (
        <div className="tool-activity-detail">
          <p>{tool.summary}</p>
          {detail !== tool.summary ? <p className="tool-activity-result">{detail}</p> : null}
          {waiting && onApprove && onReject ? (
            <div className="tool-activity-actions">
              <button type="button" data-testid="e2e/tasks/detail/tool-activity/reject#button" disabled={pending !== null} onClick={() => void decide('reject')}>
                {pending === 'reject' ? '拒绝中' : '拒绝'}
              </button>
              <button type="button" data-testid="e2e/tasks/detail/tool-activity/approve#button" disabled={pending !== null} onClick={() => void decide('approve')}>
                {pending === 'approve' ? '允许中' : '允许一次'}
              </button>
            </div>
          ) : null}
          {error ? <p className="tool-activity-error" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </article>
  )
}

function isTerminal(status: ToolInvocationProjection['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function toolStatusLabel(status: ToolInvocationProjection['status']): string {
  return ({ proposed: '准备中', waiting_approval: '等待允许', queued: '排队中', running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消' })[status]
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs} 毫秒` : `${(durationMs / 1000).toFixed(1)} 秒`
}
