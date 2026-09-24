import { useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronRight, Globe2, Search, SquareTerminal, Wrench } from 'lucide-react'
import type {
  ActivityToolProjection,
  TaskProjection,
  ToolInvocationProjection
} from '@actiondriver/contracts'
import { MarkdownContent } from './MarkdownContent'

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
  const hasVisibleContent = timeline.some((item) =>
    item.kind === 'text'
      ? item.phase !== 'final' && item.content.length > 0
      : item.kind === 'tool'
        ? tools.has(item.callId)
        : activities.has(item.activityId)
  )
  const latestItem = timeline.at(-1)
  const hasPendingText = latestItem?.kind === 'text' && latestItem.phase === 'pending'
  const hasActiveTool = [...tools.values()].some((tool) =>
    ['proposed', 'queued', 'running', 'waiting_approval'].includes(tool.status)
  )
  const showThinking = task.status === 'running' && !hasPendingText && !hasActiveTool
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
  const body = (
    <div className="activity-timeline-items">
      {timeline.map((item) => {
        if (item.kind === 'text') {
          if (task.status !== 'running' && item.phase === 'final') return null
          return (
            <MarkdownContent
              key={item.id}
              className="activity-process-text markdown-content"
              content={item.content}
            />
          )
        }
        if (item.kind === 'tool') return <ToolRow key={item.id} tool={tools.get(item.callId)} />
        const activity = activities.get(item.activityId)
        if (!activity) return null
        const visibleToolItems = activity.items.filter(
          (child): child is ActivityToolProjection =>
            child.kind === 'tool' && tools.has(child.callId)
        )
        const latestTool = tools.get(visibleToolItems.at(-1)?.callId ?? '')
        const titleIsActive =
          activity.status === 'running' &&
          (!latestTool ||
            ['proposed', 'queued', 'running', 'waiting_approval'].includes(latestTool.status))
        const heading = (
          <>
            <ActivityIcon
              title={activity.title}
              toolIds={visibleToolItems.map((child) => tools.get(child.callId)?.toolId ?? '')}
              currentToolId={
                latestTool &&
                ['proposed', 'queued', 'running', 'waiting_approval'].includes(latestTool.status)
                  ? latestTool.toolId
                  : null
              }
            />
            <span className={titleIsActive ? 'activity-active-title' : undefined}>
              {activity.title}
            </span>
          </>
        )
        if (visibleToolItems.length === 0) {
          return (
            <div key={item.id} className="activity-group activity-group-static">
              <div className="activity-group-heading">{heading}</div>
            </div>
          )
        }
        return (
          <details
            key={item.id}
            className="activity-group"
            open={task.status === 'running' && activity.status === 'running'}
          >
            <summary data-testid="e2e/tasks/detail/activity/toggle#button">
              {heading}
              <ChevronRight aria-hidden="true" className="activity-chevron" size={16} />
            </summary>
            <div className="activity-items">
              {visibleToolItems.map((child) => (
                <ToolRow key={child.id} tool={tools.get(child.callId)} />
              ))}
            </div>
          </details>
        )
      })}
    </div>
  )

  return (
    <section
      className={`activity-timeline${showThinking && !hasVisibleContent ? ' is-initial-thinking' : ''}`}
      aria-label="任务过程"
    >
      {task.status === 'running' ? (
        <>
          <div className="activity-elapsed" aria-label="已处理时间">
            已处理 {formatRunningDuration(elapsedMs)}
          </div>
          {hasVisibleContent ? body : null}
          {showThinking ? (
            <div className="activity-thinking activity-active-title" role="status">
              正在思考
            </div>
          ) : null}
        </>
      ) : hasVisibleContent ? (
        <details className="activity-archive">
          <summary data-testid="e2e/tasks/detail/activity/archive#button">
            <span>用时 {formatDuration(task.activityDurationMs)}</span>
            <ChevronRight aria-hidden="true" className="activity-chevron" size={16} />
          </summary>
          {body}
        </details>
      ) : (
        <div className="activity-elapsed">用时 {formatDuration(task.activityDurationMs)}</div>
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
  if (value < 1_000) return `${value} 毫秒`
  if (value < 60_000) return `${Math.round(value / 100) / 10} 秒`
  const seconds = Math.round(value / 1_000)
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

function ActivityIcon({
  title,
  toolIds,
  currentToolId
}: {
  title: string
  toolIds: string[]
  currentToolId: string | null
}) {
  const toolKinds = new Set(
    (currentToolId ? [currentToolId] : toolIds).filter(Boolean).map((toolId) => {
      if (/web/.test(toolId)) return 'web'
      if (/shell|command/.test(toolId)) return 'shell'
      if (/search|find|grep|rg/.test(toolId)) return 'search'
      if (/fs|file/.test(toolId)) return 'file'
      return 'other'
    })
  )
  if (toolKinds.size > 1) return <Wrench aria-hidden="true" size={16} />
  if (toolKinds.has('web')) return <Globe2 aria-hidden="true" size={16} />
  if (toolKinds.has('shell')) return <SquareTerminal aria-hidden="true" size={16} />
  if (toolKinds.has('search')) return <Search aria-hidden="true" size={16} />
  if (toolKinds.has('file')) return <BookOpen aria-hidden="true" size={16} />
  if (/搜索|网页/.test(title)) return <Globe2 aria-hidden="true" size={16} />
  if (/文件|读取/.test(title)) return <BookOpen aria-hidden="true" size={16} />
  if (/命令|脚本/.test(title)) return <SquareTerminal aria-hidden="true" size={16} />
  return <Wrench aria-hidden="true" size={16} />
}

function ToolRow({ tool }: { tool: ToolInvocationProjection | undefined }) {
  if (!tool) return null
  const hasRawIO = tool.rawInput !== undefined || tool.rawOutput !== undefined
  const shellTranscript = shellToolTranscript(tool)
  const active = ['proposed', 'queued', 'running'].includes(tool.status)
  const row = (
    <>
      <ToolIcon tool={tool} />
      <span className={`activity-tool-label${active ? ' activity-active-title' : ''}`}>
        {tool.title ? (
          toolSummary(tool, tool.title)
        ) : (
          <>
            <span>{toolAction(tool)}</span>
            <span>{toolSummary(tool)}</span>
          </>
        )}
      </span>
      {hasRawIO ? <ChevronRight aria-hidden="true" className="activity-chevron" size={16} /> : null}
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
      <div className={`activity-tool-io${shellTranscript ? ' is-terminal' : ''}`}>
        <div className="activity-tool-io-title">{toolTitle(tool)}</div>
        {shellTranscript ? (
          <pre
            className={
              tool.rawOutputTruncated || shellTranscript.text.length > 900 ? 'is-long' : undefined
            }
          >
            {shellTranscript.text}
          </pre>
        ) : (
          <>
            {tool.rawInput !== undefined ? (
              <pre className={tool.rawInput.length > 900 ? 'is-long' : undefined}>
                {tool.rawInput}
              </pre>
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
          </>
        )}
        {shellTranscript?.exitCode !== null && shellTranscript?.exitCode !== undefined ? (
          <div className="activity-tool-status">退出码 {shellTranscript.exitCode}</div>
        ) : null}
        {tool.errorSummary ? (
          <div className="activity-tool-status is-error">{tool.errorSummary}</div>
        ) : null}
      </div>
    </details>
  )
}

function toolSummary(tool: ToolInvocationProjection, label = tool.summary) {
  if (!/fs|file/.test(tool.toolId) || !tool.rawInput) return label
  const path = parseObject(tool.rawInput)?.path
  if (typeof path !== 'string') return label
  const fileName = path.split(/[\\/]/).filter(Boolean).at(-1)
  if (!fileName) return label
  const start = label.indexOf(fileName)
  if (start < 0) return label
  return (
    <>
      {label.slice(0, start)}
      <span className="activity-tool-path">{fileName}</span>
      {label.slice(start + fileName.length)}
    </>
  )
}

function shellToolTranscript(
  tool: ToolInvocationProjection
): { text: string; exitCode: number | null } | null {
  if (!/shell|command/.test(tool.toolId) || !tool.rawInput) return null
  const input = parseObject(tool.rawInput)
  if (
    typeof input?.command !== 'string' ||
    !Array.isArray(input.args) ||
    !input.args.every((arg) => typeof arg === 'string')
  )
    return null
  const command = [
    input.command,
    ...input.args.map((arg: string) => (/[\s"'\\]/.test(arg) ? JSON.stringify(arg) : arg))
  ].join(' ')
  const output = tool.rawOutput === undefined ? null : parseObject(tool.rawOutput)
  const chunks = output
    ? [output.stdout, output.stderr, output.content].filter(
        (value): value is string => typeof value === 'string' && value.length > 0
      )
    : []
  const response = chunks.length
    ? chunks.join('\n').trimEnd()
    : tool.rawOutput && !output
      ? tool.rawOutput
      : ''
  const result = output?.result
  const exitCode =
    result &&
    typeof result === 'object' &&
    'exitCode' in result &&
    typeof result.exitCode === 'number'
      ? result.exitCode
      : null
  return {
    text: [`$ ${command}`, response, tool.rawOutputTruncated ? '…输出已截断' : '']
      .filter(Boolean)
      .join('\n'),
    exitCode
  }
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function ToolIcon({ tool }: { tool: ToolInvocationProjection }) {
  if (/web/.test(tool.toolId)) return <Globe2 aria-hidden="true" size={16} />
  if (/shell|command/.test(tool.toolId)) return <SquareTerminal aria-hidden="true" size={16} />
  if (/search|find|grep|rg/.test(tool.toolId)) return <Search aria-hidden="true" size={16} />
  if (/fs|file/.test(tool.toolId)) return <BookOpen aria-hidden="true" size={16} />
  return <Wrench aria-hidden="true" size={16} />
}

function toolAction(tool: ToolInvocationProjection): string {
  if (tool.status === 'unknown') return '结果未知：'
  if (tool.status === 'failed') return '执行失败：'
  if (tool.status === 'cancelled') return '已取消：'
  if (tool.status === 'waiting_approval') return '旧审批记录：'
  if (tool.status === 'running' || tool.status === 'queued' || tool.status === 'proposed')
    return '正在运行 '
  if (/web/.test(tool.toolId)) return '已搜索网页：'
  if (/search|find|grep|rg/.test(tool.toolId)) return '已搜索 '
  if (/shell|command/.test(tool.toolId)) return '已运行 '
  if (/fs|file/.test(tool.toolId)) return '已读取 '
  return '已调用 '
}

function toolTitle(tool: ToolInvocationProjection): string {
  if (/shell|command/.test(tool.toolId)) return 'Shell'
  if (/web/.test(tool.toolId)) return 'Web Search'
  if (/search|find|grep|rg/.test(tool.toolId)) return '搜索'
  if (/fs|file/.test(tool.toolId)) return '文件'
  return '工具'
}
