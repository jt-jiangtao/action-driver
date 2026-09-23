import { useEffect, useState } from 'react'
import type { ToolInvocationProjection } from '@actiondriver/contracts'
import { e2eId } from '../testing/e2e-id'

export function ToolActivityCards({ tools, onApprove, onReject }: { tools: readonly ToolInvocationProjection[]; onApprove?(callId: string, argumentsHash: string): Promise<void>; onReject?(callId: string, argumentsHash: string): Promise<void> }) {
  const running = tools.filter((tool) => !terminal(tool.status))
  const completed = tools.filter((tool) => terminal(tool.status))
  const latest = running.at(-1)?.callId ?? null
  const [open, setOpen] = useState<string | null>(latest)
  useEffect(() => { setOpen(latest) }, [latest])
  if (!tools.length) return null
  return <div className="tool-activity-list" aria-label="工具活动">
    <Group id="e2e/tasks/detail/tool-activity/running#section" title="正在运行中" tools={running} open={open} setOpen={setOpen} {...(onApprove ? { onApprove } : {})} {...(onReject ? { onReject } : {})} />
    <Group id="e2e/tasks/detail/tool-activity/completed#section" title="运行结束" tools={completed} open={open} setOpen={setOpen} {...(onApprove ? { onApprove } : {})} {...(onReject ? { onReject } : {})} />
  </div>
}
function Group({ id, title, tools, open, setOpen, onApprove, onReject }: { id: string; title: string; tools: readonly ToolInvocationProjection[]; open: string | null; setOpen(value: string | null): void; onApprove?(callId: string, argumentsHash: string): Promise<void>; onReject?(callId: string, argumentsHash: string): Promise<void> }) {
  if (!tools.length) return null
  return <section className="tool-activity-group" data-testid={e2eId('e2e/tasks/detail/tool-activity/:state#section', { state: id.includes('/running') ? 'running' : 'completed' })} aria-label={title}><h2>{title}</h2>{tools.map((tool) => <Card key={tool.callId} tool={tool} open={open === tool.callId} toggle={() => setOpen(open === tool.callId ? null : tool.callId)} {...(onApprove ? { onApprove } : {})} {...(onReject ? { onReject } : {})} />)}</section>
}
function Card({ tool, open, toggle, onApprove, onReject }: { tool: ToolInvocationProjection; open: boolean; toggle(): void; onApprove?(callId: string, argumentsHash: string): Promise<void>; onReject?(callId: string, argumentsHash: string): Promise<void> }) {
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const decide = async (action: 'approve' | 'reject') => { const fn = action === 'approve' ? onApprove : onReject; if (!fn || pending) return; setPending(action); setError(null); try { await fn(tool.callId, tool.argumentsHash) } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } finally { setPending(null) } }
  const detail = tool.resultSummary ?? tool.errorSummary ?? tool.summary
  return <article className={`tool-activity-card is-${tool.status}`}><button type="button" className="tool-activity-toggle" data-testid="e2e/tasks/detail/tool-activity/card-toggle#button" aria-expanded={open} aria-label={`${tool.toolId}：${label(tool.status)}`} onClick={toggle}><span className="tool-activity-title">{tool.toolId}</span><span className="tool-activity-state">{label(tool.status)}</span>{tool.durationMs !== undefined ? <span className="tool-activity-duration">{tool.durationMs} 毫秒</span> : null}</button>{open ? <div className="tool-activity-detail"><p>{tool.summary}</p>{detail !== tool.summary ? <p>{detail}</p> : null}{tool.status === 'waiting_approval' && onApprove && onReject ? <div className="tool-activity-actions"><button type="button" data-testid="e2e/tasks/detail/tool-activity/reject#button" disabled={pending !== null} onClick={() => void decide('reject')}>拒绝</button><button type="button" data-testid="e2e/tasks/detail/tool-activity/approve#button" disabled={pending !== null} onClick={() => void decide('approve')}>允许一次</button></div> : null}{error ? <p role="alert">{error}</p> : null}</div> : null}</article>
}
function terminal(status: ToolInvocationProjection['status']) { return status === 'completed' || status === 'failed' || status === 'cancelled' }
function label(status: ToolInvocationProjection['status']) { return ({ proposed: '准备中', waiting_approval: '等待允许', queued: '排队中', running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消' })[status] }
