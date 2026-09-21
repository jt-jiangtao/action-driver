import type { TaskLayoutMode } from '../BrowserPanel'
import { IconButton } from '../ui/IconButton'

export function BrowserSizeToggle({
  expanded,
  onModeChange
}: {
  expanded: boolean
  onModeChange(mode: TaskLayoutMode): void
}) {
  return (
    <IconButton
      aria-label={expanded ? '缩小浏览器' : '放大浏览器'}
      className="browser-plain-button"
      icon={expanded ? 'minimize' : 'maximize'}
      onClick={() => onModeChange(expanded ? 'split' : 'browser-expanded')}
    />
  )
}
