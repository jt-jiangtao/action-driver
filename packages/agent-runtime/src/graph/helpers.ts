import type { ImageAssetRef } from '@action-driver/contracts'
import type { RuntimeMessage } from '../ports'

export function isVolatileComputerImage(value: unknown): value is ImageAssetRef {
  if (typeof value !== 'object' || value === null) return false
  const image = value as Partial<ImageAssetRef>
  return (
    typeof image.assetId === 'string' &&
    image.assetId.startsWith('volatile-computer:') &&
    typeof image.sessionId === 'string' &&
    (image.mimeType === 'image/png' || image.mimeType === 'image/jpeg') &&
    typeof image.width === 'number' &&
    typeof image.height === 'number' &&
    typeof image.byteLength === 'number' &&
    image.source === 'upload'
  )
}

export function stripVolatileScreenshotMessages(messages: RuntimeMessage[]): RuntimeMessage[] {
  return messages.filter((message) => {
    if (message.role !== 'user' || !Array.isArray(message.content)) return true
    return !message.content.some(
      (part) => part.kind === 'image' && part.asset.assetId.startsWith('volatile-computer:')
    )
  })
}

export function volatileScreenshotIds(messages: RuntimeMessage[]): string[] {
  return messages.flatMap((message) =>
    message.role === 'user' && Array.isArray(message.content)
      ? message.content.flatMap((part) =>
          part.kind === 'image' && part.asset.assetId.startsWith('volatile-computer:')
            ? [part.asset.assetId]
            : []
        )
      : []
  )
}

export function threadIdForTask(taskId: string): string {
  if (!taskId.trim()) throw new Error('Task id is required to create a LangGraph thread id')
  return taskId
}

export function sessionInputNotice(
  files: ReadonlyArray<{ name: string; path: string; mimeType: string }>
): string {
  return [
    '本会话上传的文件已在工作目录内可直接读取（不要重新创建或猜测内容）：',
    ...files.map((file) => `- ${file.name}（${file.mimeType}）: ${file.path}`)
  ].join('\n')
}

export function defaultActivityId(taskId: string): string {
  return `activity:${taskId}:default`
}

export function nextActivityId(taskId: string, toolRound: number, index: number): string {
  return `activity:${taskId}:tools:${toolRound}:${index}`
}

export function activityTitleForTool(
  modelName: string,
  status: 'running' | 'completed' | 'failed' | 'cancelled' = 'running'
): string {
  const normalized = modelName.toLowerCase()
  const action =
    normalized === 'tools_local_web_open'
      ? '读取网页'
      : normalized.includes('web')
        ? '搜索网页'
        : normalized.includes('shell') || normalized === 'command'
          ? '执行命令'
          : normalized.includes('python')
            ? '运行 Python'
            : normalized.includes('tools_local_command_typescript_run') ||
                normalized.includes('typescript')
              ? '运行 TypeScript'
              : normalized.includes('tools_local_command_node_run') ||
                  normalized.includes('node.run')
                ? '运行 Node.js'
                : normalized === 'tools_local_cua_js'
                  ? '操作桌面应用'
                  : normalized === 'tools_local_cua_reset'
                    ? '重置 Computer Use'
                    : '调用工具'
  if (status === 'running') return `正在${action}`
  if (status === 'completed') return `已${action}`
  if (status === 'cancelled') return `已取消${action}`
  return `${action}失败`
}

export function activityTitleForTools(
  goal: string,
  modelNames: string[],
  status: 'running' | 'completed' | 'failed' | 'cancelled' = 'running',
  issueCount = 0
): string {
  const kinds = new Set(modelNames.map(activityToolKind))
  const count = modelNames.length
  const category = [...kinds]
    .map((kind) =>
      kind === 'web' ? '网页' : kind === 'shell' ? '命令' : kind === 'script' ? '脚本' : '其他工具'
    )
    .join('、')
  const firstSentence = goal
    .trim()
    .replace(/\s+/g, ' ')
    .split(/[。！？\n]/)[0]
    ?.trim()
  const shortGoal = firstSentence?.replace(/[，,；;:：]$/, '')
  if (shortGoal && /[\u3400-\u9fff]/.test(shortGoal) && shortGoal.length <= 24) {
    const detail =
      count === 1
        ? ''
        : kinds.size > 1
          ? `：${category}`
          : ` · ${count} ${kinds.has('shell') ? '条命令' : '项操作'}`
    const summary = `${shortGoal}${detail}`
    if (status === 'running') return `正在${summary}`
    if (status === 'failed' && count === 1) return `${summary}（执行失败）`
    if (status === 'cancelled' && count === 1) return `${summary}（已取消）`
    // A group with unfinished work keeps the neutral plan wording: failures are
    // visible on the individual tool rows, not as a count in the title.
    if (issueCount > 0) return summary
    if (status === 'completed') return `已完成${summary}`
    if (status === 'cancelled') return `已取消${summary}`
    return `${summary}失败`
  }
  if (count === 1) return activityTitleForTool(modelNames[0]!, status)
  if (kinds.size > 1) {
    const summary = `使用${category}工具`
    if (status === 'running') return `正在${summary}`
    if (issueCount > 0) return summary
    if (status === 'completed') return `已完成${summary}`
    if (status === 'cancelled') return `已取消${summary}`
    return `${summary}失败`
  }
  const subject =
    kinds.size === 1 && kinds.has('web')
      ? `${count} 项${
          modelNames.every((name) => name.toLowerCase() === 'tools_local_web_open')
            ? '网页读取'
            : modelNames.every((name) => name.toLowerCase() === 'tools_local_web_search')
              ? '网页搜索'
              : '网页操作'
        }`
      : kinds.size === 1 && kinds.has('shell')
        ? `${count} 条命令`
        : `${count} 项操作`
  if (status === 'running') return `正在执行 ${subject}`
  if (issueCount > 0) return `已处理 ${subject}`
  if (status === 'completed') return `已执行 ${subject}`
  if (status === 'cancelled') return `已取消 ${subject}`
  return `${subject}执行失败`
}

function activityToolKind(modelName: string): 'web' | 'shell' | 'script' | 'other' {
  const normalized = modelName.toLowerCase()
  if (normalized.includes('web')) return 'web'
  if (normalized.includes('shell') || normalized === 'command') return 'shell'
  if (
    normalized.includes('python') ||
    normalized.includes('tools_local_command_typescript_run') ||
    normalized.includes('typescript') ||
    normalized.includes('tools_local_command_node_run') ||
    normalized.includes('node.run')
  )
    return 'script'
  return 'other'
}
