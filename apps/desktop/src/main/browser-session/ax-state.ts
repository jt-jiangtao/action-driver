type AXNode = {
  nodeId?: string
  parentId?: string
  ignored?: boolean
  role?: { value?: unknown }
  name?: { value?: unknown }
  value?: { value?: unknown }
}

/** Bound CDP accessibility output before it crosses the agent RPC boundary. */
export function formatBrowserAXTree(nodes: AXNode[]): string {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]))
  const depth = (node: AXNode) => {
    let current = node
    let count = 0
    const visited = new Set<string>()
    while (current.parentId && !visited.has(current.parentId) && count < 20) {
      visited.add(current.parentId)
      const parent = byId.get(current.parentId)
      if (!parent) break
      count++
      current = parent
    }
    return count
  }
  const lines = nodes.filter((node) => !node.ignored).slice(0, 2_000).map((node) => {
    const role = String(node.role?.value ?? 'generic')
    const name = node.name?.value == null ? '' : ` ${JSON.stringify(String(node.name.value))}`
    const value = node.value?.value == null ? '' : `: ${String(node.value.value)}`
    return `${'  '.repeat(depth(node))}- ${role}${name}${value}`
  })
  return lines.join('\n').slice(0, 100_000)
}
