import type { TaskProjection } from '@action-driver/contracts'

export function taskUsesComputerUse(task: TaskProjection | null | undefined): boolean {
  return Boolean(task?.tools?.some((tool) => tool.toolId === 'tools/local/cua/js'))
}
