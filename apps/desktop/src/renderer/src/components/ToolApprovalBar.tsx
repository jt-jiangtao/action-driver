import { useState } from 'react'
import type { ToolInvocationProjection } from '@actiondriver/contracts'

export function ToolApprovalBar({
  tools,
  onApprove,
  onReject
}: {
  tools: readonly ToolInvocationProjection[]
  onApprove?(callId: string, argumentsHash: string): Promise<void>
  onReject?(callId: string, argumentsHash: string): Promise<void>
}) {
  const tool = tools.find((candidate) => candidate.status === 'waiting_approval')
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null)
  if (!tool || !onApprove || !onReject) return null
  const decide = async (action: 'approve' | 'reject') => {
    if (pending) return
    setPending(action)
    try {
      await (action === 'approve' ? onApprove : onReject)(tool.callId, tool.argumentsHash)
    } finally {
      setPending(null)
    }
  }
  return (
    <aside className="tool-approval-bar" aria-label="工具审批">
      <span>需要允许：{tool.summary}</span>
      <div>
        <button
          type="button"
          data-testid="e2e/tasks/detail/activity/reject#button"
          onClick={() => void decide('reject')}
          disabled={pending !== null}
        >
          拒绝
        </button>
        <button
          type="button"
          data-testid="e2e/tasks/detail/activity/approve#button"
          onClick={() => void decide('approve')}
          disabled={pending !== null}
        >
          {pending === 'approve' ? '允许中' : '允许一次'}
        </button>
      </div>
    </aside>
  )
}
