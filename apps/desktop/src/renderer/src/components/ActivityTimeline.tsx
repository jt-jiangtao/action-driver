import type { TaskProjection, ToolInvocationProjection } from '@actiondriver/contracts'

export function ActivityTimeline({ task }: { task: TaskProjection }) {
  const activities = new Map(
    (task.activities ?? []).map((activity) => [activity.activityId, activity])
  )
  const tools = new Map((task.tools ?? []).map((tool) => [tool.callId, tool]))
  const timeline = task.activityTimeline ?? []
  if (timeline.length === 0 && task.status !== 'running') return null

  const body = (
    <div className="activity-timeline-items">
      {timeline.map((item) => {
        if (item.kind === 'text')
          return (
            <p key={item.id} className="activity-standalone-text">
              {item.content}
            </p>
          )
        const activity = activities.get(item.activityId)
        if (!activity) return null
        return (
          <details key={item.id} className="activity-group" open={activity.status === 'running'}>
            <summary data-testid="e2e/tasks/detail/activity/toggle#button">
              {activity.title}
              <span aria-hidden="true">⌄</span>
            </summary>
            <div className="activity-items">
              {activity.items.map((child) =>
                child.kind === 'text' ? (
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
          {body}
          <div className="activity-thinking" aria-live="polite">
            正在思考
          </div>
        </>
      ) : (
        <details className="activity-archive">
          <summary data-testid="e2e/tasks/detail/activity/archive#button">
            用时 {formatDuration(task.activityDurationMs)}
          </summary>
          {body}
        </details>
      )}
    </section>
  )
}

function formatDuration(value?: number): string {
  if (value === undefined) return '—'
  return value < 1000 ? `${value} 毫秒` : `${Math.round(value / 100) / 10} 秒`
}

function ToolRow({ tool }: { tool: ToolInvocationProjection | undefined }) {
  if (!tool) return null
  const detail = tool.resultSummary ?? tool.errorSummary
  const hasRawIO = tool.rawInput !== undefined || tool.rawOutput !== undefined
  return (
    <div className={`activity-tool is-${tool.status}`}>
      <span aria-hidden="true">⌘</span>
      <span>{tool.summary}</span>
      {detail ? <small>{detail}</small> : null}
      {hasRawIO ? (
        <details className="activity-tool-io">
          <summary data-testid="e2e/tasks/detail/activity/raw-io#button">输入与输出</summary>
          {tool.rawInput !== undefined ? <pre>{tool.rawInput}</pre> : null}
          {tool.rawOutput !== undefined ? (
            <pre>
              {tool.rawOutput}
              {tool.rawOutputTruncated ? '\n…输出已截断' : ''}
            </pre>
          ) : null}
        </details>
      ) : null}
    </div>
  )
}
