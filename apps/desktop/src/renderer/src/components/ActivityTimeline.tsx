import { useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronDown, FileText, Globe2, Terminal, Wrench } from 'lucide-react'
import type { TaskProjection, ToolInvocationProjection } from '@actiondriver/contracts'

export function ActivityTimeline({ task }: { task: TaskProjection }) {
  const activities = new Map(
    (task.activities ?? []).map((activity) => [activity.activityId, activity])
  )
  const tools = new Map((task.tools ?? []).map((tool) => [tool.callId, tool]))
  const timeline =
    task.activityTimeline && task.activityTimeline.length > 0
      ? task.activityTimeline
      : (task.tools ?? []).map((tool) => ({
          id: `tool:${tool.callId}`,
          kind: 'tool' as const,
          callId: tool.callId
        }))
  const fallbackStartedAt = useRef(Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (task.status !== 'running') return
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(interval)
  }, [task.status, task.id, task.activityStartedAt])

  const startedAt = task.activityStartedAt
    ? Date.parse(task.activityStartedAt)
    : fallbackStartedAt.current
  const elapsedMs = Math.max(
    0,
    now - (Number.isFinite(startedAt) ? startedAt : fallbackStartedAt.current)
  )
  const toolIsActive = (task.tools ?? []).some((tool) =>
    ['proposed', 'waiting_approval', 'queued', 'running'].includes(tool.status)
  )

  const body = (
    <div className="activity-timeline-items">
      {timeline.map((item) => {
        if (item.kind === 'text') {
          if (item.phase === 'final') return null
          return (
            <p key={item.id} className="activity-standalone-text">
              {item.content}
            </p>
          )
        }
        if (item.kind === 'tool') return <ToolRow key={item.id} tool={tools.get(item.callId)} />
        const activity = activities.get(item.activityId)
        if (!activity) return null
        return (
          <details key={item.id} className="activity-group" open={task.status === 'running'}>
            <summary data-testid="e2e/tasks/detail/activity/toggle#button">
              <ActivityIcon title={activity.title} />
              <span className={activity.status === 'running' ? 'activity-active-title' : undefined}>
                {activity.title}
              </span>
              <ChevronDown aria-hidden="true" className="activity-chevron" size={17} />
            </summary>
            <div className="activity-items">
              {activity.items.map((child) =>
                child.kind === 'text' && child.phase === 'final' ? null : child.kind === 'text' ? (
                  <p key={child.id} className="activity-text">
                    {child.content}
                  </p>
                ) : (
                  <ToolRow key={child.id} tool={tools.get(child.callId)} />
                )
              )}
            </div>
          </details>
        )
      })}
    </div>
  )

  return (
    <section className="activity-timeline" aria-label="任务过程">
      {task.status === 'running' ? (
        <>
          <div className="activity-elapsed" aria-label="已处理时间">
            已处理 {formatRunningDuration(elapsedMs)}
          </div>
          {body}
          {!toolIsActive ? (
            <div className="activity-thinking" aria-live="polite">
              正在思考
            </div>
          ) : null}
        </>
      ) : (
        <details className="activity-archive">
          <summary data-testid="e2e/tasks/detail/activity/archive#button">
            <span>用时 {formatDuration(task.activityDurationMs)}</span>
            <ChevronDown aria-hidden="true" size={17} />
          </summary>
          {body}
        </details>
      )}
    </section>
  )
}

function formatRunningDuration(value: number): string {
  const seconds = Math.floor(value / 1_000)
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

function formatDuration(value?: number): string {
  if (value === undefined) return '—'
  return value < 1_000 ? `${value} 毫秒` : `${Math.round(value / 100) / 10} 秒`
}

function ActivityIcon({ title }: { title: string }) {
  if (/搜索|网页/.test(title)) return <Globe2 aria-hidden="true" size={18} />
  if (/文件|读取/.test(title)) return <BookOpen aria-hidden="true" size={18} />
  if (/命令|脚本/.test(title)) return <Terminal aria-hidden="true" size={18} />
  return <Wrench aria-hidden="true" size={18} />
}

function ToolRow({ tool }: { tool: ToolInvocationProjection | undefined }) {
  if (!tool) return null
  const hasRawIO = tool.rawInput !== undefined || tool.rawOutput !== undefined
  const active = ['proposed', 'waiting_approval', 'queued', 'running'].includes(tool.status)
  const row = (
    <>
      <ToolIcon tool={tool} />
      <span className={`activity-tool-label${active ? ' activity-active-title' : ''}`}>
        <span>{toolAction(tool)}</span>
        <span>{tool.summary}</span>
      </span>
      {hasRawIO ? <ChevronDown aria-hidden="true" className="activity-chevron" size={17} /> : null}
    </>
  )
  if (!hasRawIO) {
    return (
      <div className={`activity-tool is-${tool.status}`}>
        <div className="activity-tool-line">{row}</div>
      </div>
    )
  }
  return (
    <details className={`activity-tool is-${tool.status}`}>
      <summary className="activity-tool-line" data-testid="e2e/tasks/detail/activity/raw-io#button">
        {row}
      </summary>
      <div className="activity-tool-io">
        <div className="activity-tool-io-title">{toolTitle(tool)}</div>
        {tool.rawInput !== undefined ? (
          <pre className={tool.rawInput.length > 900 ? 'is-long' : undefined}>{tool.rawInput}</pre>
        ) : null}
        {tool.rawOutput !== undefined ? (
          <pre
            className={
              tool.rawOutputTruncated || tool.rawOutput.length > 900 ? 'is-long' : undefined
            }
          >
            {tool.rawOutput}
            {tool.rawOutputTruncated ? '\n…输出已截断' : ''}
          </pre>
        ) : null}
        {tool.errorSummary ? (
          <div className="activity-tool-status is-error">{tool.errorSummary}</div>
        ) : null}
      </div>
    </details>
  )
}

function ToolIcon({ tool }: { tool: ToolInvocationProjection }) {
  if (/web|search/.test(tool.toolId)) return <Globe2 aria-hidden="true" size={18} />
  if (/shell|command/.test(tool.toolId)) return <Terminal aria-hidden="true" size={18} />
  if (/fs|file/.test(tool.toolId)) return <FileText aria-hidden="true" size={18} />
  return <Wrench aria-hidden="true" size={18} />
}

function toolAction(tool: ToolInvocationProjection): string {
  if (tool.status === 'failed') return '执行失败：'
  if (tool.status === 'cancelled') return '已取消：'
  if (tool.status === 'waiting_approval') return '等待审批：'
  if (tool.status === 'running' || tool.status === 'queued' || tool.status === 'proposed')
    return '正在运行 '
  if (/web|search/.test(tool.toolId)) return '已搜索网页：'
  if (/shell|command/.test(tool.toolId)) return '已运行 '
  if (/fs|file/.test(tool.toolId)) return '已读取 '
  return '已调用 '
}

function toolTitle(tool: ToolInvocationProjection): string {
  if (/shell|command/.test(tool.toolId)) return 'Shell'
  if (/web|search/.test(tool.toolId)) return 'Web Search'
  if (/fs|file/.test(tool.toolId)) return '文件'
  return '工具'
}
