import type { ReactNode } from 'react'
import { memo, useRef, useState } from 'react'
import {
  BookOpen,
  Boxes,
  Braces,
  ChevronRight,
  FileCode2,
  FilePenLine,
  FileText,
  Globe2,
  Image as ImageIcon,
  Layers,
  MousePointer2,
  Package,
  PackagePlus,
  Search,
  SquareTerminal
} from 'lucide-react'
import type { ActivityProjection, ToolInvocationProjection } from '@actiondriver/contracts'
import {
  ToolDetails,
  toolDetails,
  toolPresentation,
  commandPreview,
  TOOL_DETAILS_MAX_HEIGHT
} from './ToolDetails'
import type { ImageReader } from './ConversationImage'
import { useScrollFade } from '../scroll-fade'

/**
 * One tool group as it appears *inside* the assistant transcript. The runtime
 * anchors a group where its tools ran, so prose, tools and images keep the
 * order the model produced them in — exactly like Codex's item stream.
 */
export const ActivityGroup = memo(function ActivityGroup({
  activity,
  tools,
  readImage
}: {
  activity: ActivityProjection
  tools: Map<string, ToolInvocationProjection>
  readImage?: ImageReader | undefined
}) {
  const visibleToolItems = activity.items.filter(
    (child): child is Extract<typeof child, { kind: 'tool' }> =>
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
          (latestTool && ['proposed', 'queued', 'waiting_approval'].includes(latestTool.status)
            ? latestTool.toolId
            : null)
        }
      />
      <span className={titleIsActive ? 'activity-active-title' : undefined}>{activity.title}</span>
    </>
  )
  if (visibleToolItems.length === 0) {
    return (
      <div className="activity-group activity-group-static">
        <div className="activity-group-heading">{heading}</div>
      </div>
    )
  }
  return (
    <details className="activity-group">
      <summary data-testid="e2e/tasks/detail/activity/toggle#button">
        {heading}
        <ChevronRight aria-hidden="true" className="activity-chevron" size={16} />
      </summary>
      <ActivityItems>
        {visibleToolItems.map((child) => (
          <ToolRow key={child.id} tool={tools.get(child.callId)} readImage={readImage} />
        ))}
      </ActivityItems>
    </details>
  )
})

export function ActivityItems({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useScrollFade(ref)
  return (
    <div
      ref={ref}
      className="activity-items"
      style={{ maxHeight: TOOL_DETAILS_MAX_HEIGHT, overflow: 'auto' }}
    >
      {children}
    </div>
  )
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
      if (/^(?:computer\.|tools\.local\.computer-use\.)/.test(toolId)) return 'computer'
      if (/image/.test(toolId)) return 'image'
      if (/web/.test(toolId)) return 'web'
      if (/shell|command|python|node\.run|typescript/.test(toolId)) return 'shell'
      if (/search|find|grep|rg/.test(toolId)) return 'search'
      return 'other'
    })
  )
  // Image generation keeps the imagegen Skill mark, exactly like its tool row.
  if (toolKinds.has('image') && toolKinds.size === 1)
    return <ImageIcon aria-hidden="true" size={16} />
  // A mixed group reads as "several stacked tools".
  if (toolKinds.size > 1) return <Layers aria-hidden="true" size={16} />
  if (toolKinds.has('computer')) return <MousePointer2 aria-hidden="true" size={16} />
  if (toolKinds.has('web')) return <Globe2 aria-hidden="true" size={16} />
  if (toolKinds.has('shell')) return <SquareTerminal aria-hidden="true" size={16} />
  if (toolKinds.has('search')) return <Search aria-hidden="true" size={16} />
  if (/图片/.test(title)) return <ImageIcon aria-hidden="true" size={16} />
  if (/搜索|网页/.test(title)) return <Globe2 aria-hidden="true" size={16} />
  if (/命令|脚本/.test(title)) return <SquareTerminal aria-hidden="true" size={16} />
  return <Boxes aria-hidden="true" size={16} />
}

export const ToolRow = memo(function ToolRow({
  tool,
  readImage
}: {
  tool: ToolInvocationProjection | undefined
  readImage?: ImageReader | undefined
}) {
  const [expanded, setExpanded] = useState(false)
  if (!tool) return null
  const details = toolDetails(tool)
  const hasDetails =
    details.input.length > 0 ||
    details.output.length > 0 ||
    tool.rawInput !== undefined ||
    tool.rawOutput !== undefined
  const terminal = (details.layout ?? toolPresentation(tool)?.layout) === 'terminal'
  const preview = terminal ? commandPreview(details) : ''
  const commandTitle =
    terminal && preview.length > 0 && tool.durationMs !== undefined
      ? commandStatus(tool, expanded)
      : null
  const active = tool.status === 'running'
  const row = (
    <>
      <ToolIcon tool={tool} />
      <span className={`activity-tool-label${active ? ' activity-active-title' : ''}`}>
        {commandTitle ? (
          <>
            <span>{commandTitle}</span>
            {!expanded && preview ? <span className="command-preview"> {preview}</span> : null}
          </>
        ) : tool.title ? (
          <>
            <span>{tool.title}</span>
            {terminal && !expanded && preview ? (
              <span className="command-preview"> {preview}</span>
            ) : null}
          </>
        ) : (
          <>
            <span>{toolAction(tool)}</span>
            <span>{tool.summary}</span>
            {terminal && !expanded && preview ? (
              <span className="command-preview"> {preview}</span>
            ) : null}
          </>
        )}
      </span>
      {hasDetails ? (
        <ChevronRight aria-hidden="true" className="activity-chevron" size={16} />
      ) : null}
    </>
  )
  if (!hasDetails) {
    return (
      <div className={`activity-tool is-${tool.status}`}>
        <div className="activity-tool-line">{row}</div>
      </div>
    )
  }
  return (
    <details
      className={`activity-tool is-${tool.status}${terminal ? ' is-command' : ''}`}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="activity-tool-line" data-testid="e2e/tasks/detail/activity/raw-io#button">
        {row}
      </summary>
      <div className="activity-tool-io">
        <div className="activity-tool-io-title">{toolTitle(tool)}</div>
        <ToolDetails
          details={terminal ? { ...details, layout: 'terminal' } : details}
          summary={tool.summary}
          resultSummary={tool.resultSummary}
          errorSummary={tool.errorSummary}
          truncated={tool.rawOutputTruncated}
          readImage={readImage}
        />
      </div>
    </details>
  )
})

function commandStatus(tool: ToolInvocationProjection, expanded: boolean): string {
  const milliseconds = Math.max(1, Math.round(tool.durationMs ?? 0))
  const duration =
    milliseconds < 1000 ? `${milliseconds}ms` : `${Math.round(milliseconds / 100) / 10}s`
  if (tool.status === 'completed')
    return expanded ? `命令已在 ${duration} 内运行完成` : `已在 ${duration} 内运行`
  if (tool.status === 'failed')
    return expanded ? `命令在 ${duration} 内运行失败` : `运行失败（${duration}）`
  if (tool.status === 'cancelled') return expanded ? '命令已取消' : '已取消运行'
  return expanded ? '命令正在运行' : '正在运行'
}

function ToolIcon({ tool }: { tool: ToolInvocationProjection }) {
  if (/^(?:computer\.|tools\.local\.computer-use\.)/.test(tool.toolId))
    return <MousePointer2 aria-hidden="true" size={16} />
  // Codex marks image generation with the imagegen Skill icon.
  if (/image/.test(tool.toolId)) return <ImageIcon aria-hidden="true" size={16} />
  if (/skills?\.install/.test(tool.toolId)) return <PackagePlus aria-hidden="true" size={16} />
  if (/skills?\.read/.test(tool.toolId)) return <BookOpen aria-hidden="true" size={16} />
  if (/dependenc/.test(tool.toolId)) return <Package aria-hidden="true" size={16} />
  if (/web\.open/.test(tool.toolId)) return <FileText aria-hidden="true" size={16} />
  if (/web/.test(tool.toolId)) return <Globe2 aria-hidden="true" size={16} />
  if (/python/.test(tool.toolId)) return <Braces aria-hidden="true" size={16} />
  if (/node\.run|typescript|ts\.run/.test(tool.toolId))
    return <FileCode2 aria-hidden="true" size={16} />
  if (/shell|command/.test(tool.toolId)) return <SquareTerminal aria-hidden="true" size={16} />
  if (/write|edit|patch|save/.test(tool.toolId)) return <FilePenLine aria-hidden="true" size={16} />
  if (/read|cat|file|open/.test(tool.toolId)) return <FileText aria-hidden="true" size={16} />
  if (/search|find|grep|rg/.test(tool.toolId)) return <Search aria-hidden="true" size={16} />
  return <Boxes aria-hidden="true" size={16} />
}

function toolAction(tool: ToolInvocationProjection): string {
  if (/image/.test(tool.toolId)) {
    if (tool.status === 'failed') return '生成失败：'
    if (tool.status === 'cancelled') return '已取消：'
    return tool.status === 'completed' ? '已生成图片：' : '正在生成图片 '
  }
  if (/^(?:computer\.js_reset|tools\.local\.computer-use\.reset)/.test(tool.toolId)) {
    if (tool.status === 'failed') return '重置 Computer Use 失败：'
    if (tool.status === 'cancelled') return '已取消重置 Computer Use：'
    return tool.status === 'completed' ? '已重置 Computer Use：' : '正在重置 Computer Use '
  }
  if (/^(?:computer\.js|tools\.local\.computer-use\.js)/.test(tool.toolId)) {
    if (tool.status === 'failed') return '操作桌面应用失败：'
    if (tool.status === 'cancelled') return '已取消操作桌面应用：'
    return tool.status === 'completed' ? '已操作桌面应用：' : '正在操作桌面应用 '
  }
  if (tool.status === 'unknown') return '结果未知：'
  if (tool.status === 'failed') return '执行失败：'
  if (tool.status === 'cancelled') return '已取消：'
  if (tool.status === 'waiting_approval') return '旧审批记录：'
  if (tool.status === 'running' || tool.status === 'queued' || tool.status === 'proposed')
    return '正在运行 '
  if (tool.toolId.startsWith('tools.local.web.open')) return '已读取网页：'
  if (/web/.test(tool.toolId)) return '已搜索网页：'
  if (/search|find|grep|rg/.test(tool.toolId)) return '已搜索 '
  if (/shell|command|python|node\.run|typescript/.test(tool.toolId)) return '已运行 '
  return '已调用 '
}

function toolTitle(tool: ToolInvocationProjection): string {
  if (/image/.test(tool.toolId)) return '图片生成'
  if (/^(?:computer\.js|tools\.local\.computer-use\.js)/.test(tool.toolId)) return 'Computer Use'
  if (/shell|^command/.test(tool.toolId)) return 'Shell'
  if (/python/.test(tool.toolId)) return 'Python'
  if (/node\.run/.test(tool.toolId)) return 'Node.js'
  if (/typescript/.test(tool.toolId)) return 'TypeScript'
  if (tool.toolId.startsWith('tools.local.web.open')) return '网页内容'
  if (/web/.test(tool.toolId)) return 'Web Search'
  if (/search|find|grep|rg/.test(tool.toolId)) return '搜索'
  return '工具'
}
