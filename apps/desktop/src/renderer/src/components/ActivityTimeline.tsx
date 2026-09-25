import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight, Globe2, Search, SquareTerminal, Wrench } from 'lucide-react'
import { codeLanguage, ReadOnlyCode } from './ReadOnlyCode'
import { useScrollFade } from './scroll-fade'
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
  const showThinking =
    task.status === 'running' && !hasActiveTool && (!hasPendingText || !!task.preparingToolName)
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
        const runningTool = [...visibleToolItems]
          .reverse()
          .map((child) => tools.get(child.callId))
          .find((tool) => tool?.status === 'running')
        const titleIsActive = runningTool !== undefined
        const heading = (
          <>
            <ActivityIcon
              title={activity.title}
              toolIds={visibleToolItems.map((child) => tools.get(child.callId)?.toolId ?? '')}
              currentToolId={
                runningTool?.toolId ??
                (latestTool &&
                ['proposed', 'queued', 'waiting_approval'].includes(latestTool.status)
                  ? latestTool.toolId
                  : null)
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
          <details key={item.id} className="activity-group">
            <summary data-testid="e2e/tasks/detail/activity/toggle#button">
              {heading}
              <ChevronRight aria-hidden="true" className="activity-chevron" size={16} />
            </summary>
            <ActivityItems>
              {visibleToolItems.map((child) => (
                <ToolRow key={child.id} tool={tools.get(child.callId)} />
              ))}
            </ActivityItems>
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
              {task.preparingToolName
                ? `正在准备 ${preparingToolLabel(task.preparingToolName)}`
                : '正在思考'}
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

function ActivityItems({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useScrollFade(ref)
  return (
    <div ref={ref} className="activity-items">
      {children}
    </div>
  )
}

function preparingToolLabel(modelName: string): string {
  if (modelName === 'shell_run') return 'Shell 命令'
  if (modelName === 'python_run') return 'Python 脚本'
  if (modelName === 'node_run') return 'Node.js 脚本'
  if (modelName === 'ts_run') return 'TypeScript 脚本'
  if (modelName === 'web_search') return '网页搜索'
  if (modelName === 'web_open') return '网页读取'
  return modelName
}

/** Running elapsed time: whole seconds only, never below one. */
function formatRunningDuration(value: number): string {
  const seconds = Math.max(1, Math.round(value / 1_000))
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

/** Archived duration: whole seconds, never below one, minutes only when needed. */
function formatDuration(value?: number): string {
  if (value === undefined) return '—'
  const seconds = Math.max(1, Math.round(value / 1_000))
  if (seconds < 60) return `${seconds} 秒`
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
      if (/shell|command|python|node\.run|typescript/.test(toolId)) return 'shell'
      if (/search|find|grep|rg/.test(toolId)) return 'search'
      return 'other'
    })
  )
  if (toolKinds.size > 1) return <Wrench aria-hidden="true" size={16} />
  if (toolKinds.has('web')) return <Globe2 aria-hidden="true" size={16} />
  if (toolKinds.has('shell')) return <SquareTerminal aria-hidden="true" size={16} />
  if (toolKinds.has('search')) return <Search aria-hidden="true" size={16} />
  if (/搜索|网页/.test(title)) return <Globe2 aria-hidden="true" size={16} />
  if (/命令|脚本/.test(title)) return <SquareTerminal aria-hidden="true" size={16} />
  return <Wrench aria-hidden="true" size={16} />
}

function ToolRow({ tool }: { tool: ToolInvocationProjection | undefined }) {
  if (!tool) return null
  const hasRawIO = tool.rawInput !== undefined || tool.rawOutput !== undefined
  const shellTranscript = shellToolTranscript(tool)
  const webpage = webOpenResult(tool)
  const active = tool.status === 'running'
  const row = (
    <>
      <ToolIcon tool={tool} />
      <span className={`activity-tool-label${active ? ' activity-active-title' : ''}`}>
        {tool.title ? (
          tool.title
        ) : (
          <>
            <span>{toolAction(tool)}</span>
            <span>{tool.summary}</span>
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
        {webpage ? (
          <div className="activity-web-page">
            <div className="activity-web-page-title">{webpage.title}</div>
            <a
              href={webpage.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                event.preventDefault()
                void window.actionDriverDesktop.externalLinks.open(webpage.url).catch((error) => {
                  console.error('[web-open] Failed to open source link:', error)
                })
              }}
              data-testid="e2e/tasks/detail/activity/web-open/source#link"
            >
              {webpage.url}
            </a>
            <p>{webpage.text}</p>
            {webpage.truncated ? <div className="activity-tool-status">内容已截断</div> : null}
          </div>
        ) : shellTranscript ? (
          <ReadOnlyCode
            value={shellTranscript.text}
            language={shellTranscript.language}
          />
        ) : (
          <>
            {tool.rawInput !== undefined ? (
              <ReadOnlyCode value={tool.rawInput} language={codeLanguage(tool.toolId, 'json')} />
            ) : null}
            {tool.rawOutput !== undefined ? (
              <ReadOnlyCode
                value={
                  tool.rawOutputTruncated ? `${tool.rawOutput}\n…输出已截断` : tool.rawOutput
                }
                language={codeLanguage(tool.toolId, 'json')}
              />
            ) : null}
          </>
        )}
        {shellTranscript?.exitCode !== null && shellTranscript?.exitCode !== undefined ? (
          <div className="activity-tool-status">退出码 {shellTranscript.exitCode}</div>
        ) : null}
        {tool.errorSummary && !repeatsExitCode(tool.errorSummary, shellTranscript?.exitCode) ? (
          <div className="activity-tool-status is-error">{tool.errorSummary}</div>
        ) : null}
      </div>
    </details>
  )
}

/** Streams and structured fields can repeat the same line; keep each one once. */
function dedupeTranscriptLines(raw: string): string {
  const lines = raw.split('\n').map((line) => line.replace(/\s+$/, ''))
  const seen = new Set<string>()
  const kept: string[] = []
  for (const line of lines) {
    // The exit code is rendered as its own status line below the transcript.
    if (/^退出码\s+\d+$/.test(line.trim())) continue
    if (line.trim() && seen.has(line)) continue
    if (line.trim()) seen.add(line)
    kept.push(line)
  }
  return kept.join('\n').trimEnd()
}

/** The exit code is already shown above; do not repeat it as an error line. */
function repeatsExitCode(summary: string, exitCode: number | null | undefined): boolean {
  if (exitCode === null || exitCode === undefined) return false
  const text = summary.trim()
  return (
    text === `退出码 ${exitCode}` ||
    /^PROCESS_EXIT_NONZERO/.test(text) ||
    new RegExp(`(^|\\D)${exitCode}$`).test(text)
  )
}

function shellToolTranscript(
  tool: ToolInvocationProjection
): { text: string; language: string; exitCode: number | null } | null {
  if (!/shell|command|python|node\.run|typescript/.test(tool.toolId) || !tool.rawInput) return null
  const input = parseObject(tool.rawInput)
  const args = input?.args === undefined ? [] : input.args
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) return null
  const command =
    typeof input?.command === 'string'
      ? input.command
      : typeof input?.code === 'string'
        ? `${/python/.test(tool.toolId) ? 'python3' : 'node'} ${/python/.test(tool.toolId) ? '-c' : '-e'} ${JSON.stringify(input.code)}`
        : typeof input?.file === 'string'
          ? `${/python/.test(tool.toolId) ? 'python3' : 'node'} ${JSON.stringify(input.file)}`
          : null
  const script = typeof input?.script === 'string' ? input.script : null
  if (command === null && script === null) return null
  const escapedArgs = args.map((arg: string) => (/[\s"'\\]/.test(arg) ? JSON.stringify(arg) : arg))
  // A: mark the input the way a terminal would, so it never reads as output.
  const invocation =
    script === null
      ? `$ ${[command, ...escapedArgs].join(' ')}`
      : script
          .split('\n')
          // Every script line is marked, including blank lines, so the input
          // stays distinguishable from the output.
          .map((line) => (line ? `› ${line}` : '›'))
          .join('\n')
  const output = tool.rawOutput === undefined ? null : parseObject(tool.rawOutput)
  const chunks = output
    ? [output.stdout, output.stderr, output.content].filter(
        (value): value is string => typeof value === 'string' && value.length > 0
      )
    : []
  const response = dedupeTranscriptLines(
    chunks.length ? chunks.join('\n').trimEnd() : tool.rawOutput && !output ? tool.rawOutput : ''
  )
  const result = output?.result
  const exitCode =
    result &&
    typeof result === 'object' &&
    'exitCode' in result &&
    typeof result.exitCode === 'number'
      ? result.exitCode
      : null
  // One blank line separates the marked input from the raw output.
  const sections = [invocation]
  if (response) sections.push('', response)
  if (tool.rawOutputTruncated) sections.push('…输出已截断')
  return {
    text: sections.join('\n'),
    language: codeLanguage(tool.toolId),
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

function webOpenResult(tool: ToolInvocationProjection): {
  title: string
  url: string
  text: string
  truncated: boolean
} | null {
  if (!tool.toolId.startsWith('web.open') || !tool.rawOutput) return null
  const raw = parseObject(tool.rawOutput)
  const result = raw?.result
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const page = result as Record<string, unknown>
  if (
    typeof page.title !== 'string' ||
    typeof page.url !== 'string' ||
    typeof page.text !== 'string' ||
    typeof page.truncated !== 'boolean'
  )
    return null
  try {
    const url = new URL(page.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
  } catch {
    return null
  }
  return { title: page.title, url: page.url, text: page.text, truncated: page.truncated }
}

function ToolIcon({ tool }: { tool: ToolInvocationProjection }) {
  if (/web/.test(tool.toolId)) return <Globe2 aria-hidden="true" size={16} />
  if (/shell|command|python|node\.run|typescript/.test(tool.toolId))
    return <SquareTerminal aria-hidden="true" size={16} />
  if (/search|find|grep|rg/.test(tool.toolId)) return <Search aria-hidden="true" size={16} />
  return <Wrench aria-hidden="true" size={16} />
}

function toolAction(tool: ToolInvocationProjection): string {
  if (tool.status === 'unknown') return '结果未知：'
  if (tool.status === 'failed') return '执行失败：'
  if (tool.status === 'cancelled') return '已取消：'
  if (tool.status === 'waiting_approval') return '旧审批记录：'
  if (tool.status === 'running' || tool.status === 'queued' || tool.status === 'proposed')
    return '正在运行 '
  if (tool.toolId.startsWith('web.open')) return '已读取网页：'
  if (/web/.test(tool.toolId)) return '已搜索网页：'
  if (/search|find|grep|rg/.test(tool.toolId)) return '已搜索 '
  if (/shell|command|python|node\.run|typescript/.test(tool.toolId)) return '已运行 '
  return '已调用 '
}

function toolTitle(tool: ToolInvocationProjection): string {
  if (/shell|command/.test(tool.toolId)) return 'Shell'
  if (/python/.test(tool.toolId)) return 'Python'
  if (/node\.run/.test(tool.toolId)) return 'Node.js'
  if (/typescript/.test(tool.toolId)) return 'TypeScript'
  if (tool.toolId.startsWith('web.open')) return '网页内容'
  if (/web/.test(tool.toolId)) return 'Web Search'
  if (/search|find|grep|rg/.test(tool.toolId)) return '搜索'
  return '工具'
}
