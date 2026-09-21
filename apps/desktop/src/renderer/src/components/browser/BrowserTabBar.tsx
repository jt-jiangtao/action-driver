import type { TaskLayoutMode } from '../BrowserPanel'
import { AppIcon } from '../ui/AppIcon'
import { IconButton } from '../ui/IconButton'
import { BrowserSizeToggle } from './BrowserSizeToggle'

export function BrowserTabBar({
  expanded,
  title,
  onModeChange
}: {
  expanded: boolean
  title: string
  onModeChange(mode: TaskLayoutMode): void
}) {
  return (
    <div className="browser-tabbar">
      <div className="browser-tab">
        <AppIcon name="globe" />
        <span>{expanded ? '新标签页' : title}</span>
        <AppIcon name="close" />
      </div>
      <IconButton
        className="browser-plain-button"
        icon="plus"
        aria-label="新建标签页"
        testId="e2e/tasks/detail/browser/new-tab#button"
      />
      <div className="browser-window-actions">
        <BrowserSizeToggle expanded={expanded} onModeChange={onModeChange} />
        <IconButton
          aria-label="折叠浏览器"
          className="browser-plain-button"
          icon="panel-right"
          testId="e2e/tasks/detail/browser/collapse#button"
          onClick={() => onModeChange('browser-collapsed')}
        />
      </div>
    </div>
  )
}
