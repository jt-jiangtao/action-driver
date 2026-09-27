import type { PersistedToolInvocation } from './ports'

type ToolErrorLike = { code?: unknown }

export function toolActivitySummary(toolId: string, input: unknown): string {
  if (toolId === 'web.open@1') return `读取 ${webOpenHostname(input)}`
  if (toolId === 'web.search@1' && isRecord(input) && typeof input.query === 'string') {
    return `搜索 “${truncate(input.query, 120)}”`
  }
  if (toolId === 'sandbox.shell.run') return '执行命令'
  if (toolId === 'local.shell.run') return '执行命令'
  if (toolId === 'local.python.run') return '运行 Python'
  if (toolId === 'local.node.run') return '运行 Node.js'
  if (toolId === 'local.typescript.run') return '运行 TypeScript'
  if (toolId === 'image.generate@1' || toolId === 'image.generate') return '生成图片'
  if (toolId === 'computer.js') return 'Computer Use'
  if (toolId === 'computer.js_reset') return 'Computer Use 重置'
  return `运行 ${toolId}`
}

export function toolActivityTitle(
  toolId: string,
  input: unknown,
  status: PersistedToolInvocation['status']
): string {
  const type = toolId.split('@')[0] ?? toolId
  const action =
    type === 'web.open'
      ? `读取网页 ${webOpenHostname(input)}`
      : type === 'web.search'
        ? '搜索网页'
        : type === 'sandbox.shell.run'
          ? '执行命令'
          : type === 'local.shell.run'
            ? '执行命令'
            : type === 'local.python.run'
              ? '运行 Python'
              : type === 'local.node.run'
                ? '运行 Node.js'
                : type === 'local.typescript.run'
                  ? '运行 TypeScript'
                  : type === 'image.generate'
                    ? '生成图片'
                    : type === 'computer.js'
                      ? '操作桌面应用'
                      : type === 'computer.js_reset'
                        ? '重置 Computer Use'
                        : '调用工具'
  const target =
    type === 'web.search' && isRecord(input) && typeof input.query === 'string'
      ? `“${truncate(input.query, 80)}”`
      : ''
  const label = `${action}${target}`
  if (status === 'completed') return `已${label}`
  if (status === 'failed')
    return type === 'web.open'
      ? `${label} 失败`
      : type === 'local.python.run'
        ? 'Python 执行失败'
        : type === 'local.node.run'
          ? 'Node.js 执行失败'
        : type === 'local.typescript.run'
          ? 'TypeScript 执行失败'
          : type === 'computer.js'
            ? '操作桌面应用失败'
            : type === 'computer.js_reset'
              ? '重置 Computer Use 失败'
              : `${label}失败`
  if (status === 'cancelled') return `已取消${label}`
  if (status === 'unknown') return `${label}结果未知`
  if (status === 'waiting_approval') return `等待批准：${label}`
  return `正在${label}`
}

export function toolActivityResultSummary(toolId: string, output: unknown): string {
  const result = isRecord(output) && 'result' in output ? output.result : output
  if (toolId === 'web.open@1' && isRecord(result) && typeof result.title === 'string') {
    return truncate(result.title, 160)
  }
  if (toolId === 'web.search@1' && isRecord(result) && Array.isArray(result.results)) {
    const first = result.results[0]
    if (isRecord(first) && typeof first.title === 'string') return truncate(first.title, 160)
    return `返回 ${result.results.length} 条结果`
  }
  if (isRecord(output) && output.truncated === true) return '工具已完成（输出已截断）'
  return '工具已完成'
}

export function toolActivityErrorSummary(error: unknown): string {
  const code =
    isRecord(error) && typeof (error as ToolErrorLike).code === 'string'
      ? (error as { code: string }).code
      : ''
  if (code === 'TOOL_REJECTED') return '已被拒绝'
  if (code === 'TOOL_CANCELLED') return '已取消'
  if (code === 'TOOL_TIMEOUT') return '执行超时'
  if (code === 'TOOL_INPUT_INVALID') return '参数无效'
  if (code === 'PROCESS_OUTPUT_LIMIT') return '输出超限'
  if (code === 'TOOL_EXECUTION_FAILED' && isRecord(error) && typeof error.message === 'string') {
    const webOpenReasons: Record<string, string> = {
      WEB_OPEN_URL_DENIED: '仅支持公网网页',
      WEB_OPEN_CONTENT_UNSUPPORTED: '该页面不是 HTML',
      WEB_OPEN_EMPTY_CONTENT: '网页没有可读取的正文',
      WEB_OPEN_RESPONSE_LIMIT: '网页内容超出大小限制',
      WEB_OPEN_TIMEOUT: '读取网页超时',
      WEB_OPEN_PARSE_TIMEOUT: '网页解析超时',
      WEB_OPEN_PARSE_FAILED: '网页解析失败'
    }
    const reason = webOpenReasons[error.message]
    if (reason) return reason
  }
  if (code === 'PROCESS_EXIT_NONZERO' && isRecord(error) && typeof error.message === 'string') {
    const exitCode = error.message.match(/PROCESS_EXIT_NONZERO: (\d+)/)?.[1]
    if (exitCode) return `退出码 ${exitCode}`
  }
  if (code === 'TOOL_OUTCOME_UNKNOWN') return '工具结果未知'
  return '工具执行失败'
}

export function toolActivityDurationMs(startedAt: string, endedAt: string): number {
  const start = Date.parse(startedAt)
  const end = Date.parse(endedAt)
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0
}

export function persistedToolActivity(invocation: PersistedToolInvocation) {
  return {
    summary: toolActivitySummary(invocation.toolId, invocation.input),
    title: toolActivityTitle(invocation.toolId, invocation.input, invocation.status),
    durationMs: toolActivityDurationMs(invocation.createdAt, invocation.updatedAt),
    ...(invocation.status === 'completed'
      ? { resultSummary: toolActivityResultSummary(invocation.toolId, invocation.output) }
      : invocation.status === 'failed' ||
          invocation.status === 'cancelled' ||
          invocation.status === 'unknown'
        ? { errorSummary: toolActivityErrorSummary(invocation.error) }
        : {})
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`
}

function webOpenHostname(input: unknown): string {
  if (!isRecord(input) || typeof input.url !== 'string') return '网页'
  try {
    return new URL(input.url).hostname
  } catch {
    return '网页'
  }
}
