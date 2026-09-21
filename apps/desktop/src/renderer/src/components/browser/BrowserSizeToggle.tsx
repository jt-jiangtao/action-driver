import type { TaskLayoutMode } from '../BrowserPanel'
import { IconButton } from '../ui/IconButton'

export function BrowserSizeToggle({
  expanded,
  onModeChange
}: {
  expanded: boolean
  onModeChange(mode: TaskLayoutMode): void
}) {
  return expanded ? (
    <IconButton
      aria-label="缩小浏览器"
      className="browser-plain-button"
      icon="minimize"
      testId="e2e/tasks/detail/browser/restore#button"
      onClick={() => onModeChange('split')}
    />
  ) : (
    <IconButton
      aria-label="放大浏览器"
      className="browser-plain-button"
      icon="maximize"
      testId="e2e/tasks/detail/browser/expand#button"
      onClick={() => onModeChange('browser-expanded')}
    />
  )
}
