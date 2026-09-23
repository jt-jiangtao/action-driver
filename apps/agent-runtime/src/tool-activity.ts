import type { PersistedToolInvocation } from './ports'

export function toolActivitySummary(toolId: string, input: unknown): string {
  if (toolId === 'web.search@1' && isRecord(input) && typeof input.query === 'string') return `搜索 “${truncate(input.query, 120)}”`
  if (toolId.startsWith('sandbox.fs.') && isRecord(input) && typeof input.path === 'string') return `访问文件 ${truncate(input.path, 120)}`
  if (toolId === 'sandbox.shell.run') return '执行命令'
  return `运行 ${toolId}`
}

export function toolActivityResultSummary(toolId: string, output: unknown): string {
  const result = isRecord(output) && 'result' in output ? output.result : output
  if (toolId === 'web.search@1' && isRecord(result) && Array.isArray(result.results)) {
    const first = result.results[0]
    if (isRecord(first) && typeof first.title === 'string') return truncate(first.title, 160)
    return `返回 ${result.results.length} 条结果`
  }
  if (isRecord(output) && output.truncated === true) return '工具已完成（输出已截断）'
  return '工具已完成'
}

export function toolActivityErrorSummary(error: unknown): string {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : ''
  if (code === 'TOOL_REJECTED') return '已被拒绝'
  if (code === 'TOOL_CANCELLED') return '已取消'
  if (code === 'TOOL_TIMEOUT') return '执行超时'
  if (code === 'TOOL_INPUT_INVALID') return '参数无效'
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
    durationMs: toolActivityDurationMs(invocation.createdAt, invocation.updatedAt),
    ...(invocation.status === 'completed' ? { resultSummary: toolActivityResultSummary(invocation.toolId, invocation.output) } : invocation.status === 'failed' || invocation.status === 'cancelled' ? { errorSummary: toolActivityErrorSummary(invocation.error) } : {})
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' }
function truncate(value: string, maximum: number): string { return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…` }
