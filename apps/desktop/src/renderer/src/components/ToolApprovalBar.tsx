import { useState } from 'react'
import type { ToolInvocationProjection } from '@actiondriver/contracts'

export function ToolApprovalBar({
  tools,
  onApprove,
  onReject,
  width = 720
}: {
  tools: readonly ToolInvocationProjection[]
  onApprove(callId: string, argumentsHash: string): Promise<void>
  onReject(callId: string, argumentsHash: string): Promise<void>
  width?: 480 | 720
}) {
  const waiting = tools.filter((tool) => tool.status === 'waiting_approval')
  if (waiting.length === 0) return null
  return (
    <div className="tool-approval-list" data-width={width} aria-label="待审批工具调用">
      {waiting.map((tool) => (
        <ToolApprovalItem key={tool.callId} tool={tool} onApprove={onApprove} onReject={onReject} />
      ))}
    </div>
  )
}

function ToolApprovalItem({
  tool,
  onApprove,
  onReject
}: {
  tool: ToolInvocationProjection
  onApprove(callId: string, argumentsHash: string): Promise<void>
  onReject(callId: string, argumentsHash: string): Promise<void>
}) {
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const decide = async (action: 'approve' | 'reject') => {
    if (pending) return
    setPending(action)
    setError(null)
    try {
      await (action === 'approve' ? onApprove : onReject)(tool.callId, tool.argumentsHash)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPending(null)
    }
  }
  return (
    <div className="tool-approval-item" role="group" aria-label={`${tool.toolId} 审批`}>
      <div className="tool-approval-copy">
        <span className="tool-approval-label">工具请求 · {tool.toolId}</span>
        <span className="tool-approval-summary" title={tool.summary}>
          {tool.summary}
        </span>
        {error ? (
          <span className="tool-approval-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      <div className="tool-approval-actions">
        <button
          type="button"
          className="tool-approval-reject"
          data-testid="e2e/tasks/detail/tool-approval/reject#button"
          disabled={pending !== null}
          onClick={() => void decide('reject')}
        >
          {pending === 'reject' ? '拒绝中' : '拒绝'}
        </button>
        <button
          type="button"
          className="tool-approval-approve"
          data-testid="e2e/tasks/detail/tool-approval/approve#button"
          disabled={pending !== null}
          onClick={() => void decide('approve')}
        >
          {pending === 'approve' ? '允许中' : '允许一次'}
        </button>
      </div>
    </div>
  )
}
