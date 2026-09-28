import type { TaskLayoutMode } from '../BrowserPanel'
import { AppIcon } from '../ui/AppIcon'
import { IconButton } from '../ui/IconButton'
import { BrowserSizeToggle } from './BrowserSizeToggle'
import { SidebarRestoreButton } from '../navigation/SidebarRestoreButton'

export function BrowserTabBar({
  expanded,
  title,
  tabs,
  activeTabId,
  onNewTab,
  onSelectTab,
  onCloseTab,
  onModeChange,
  sidebarCollapsed = false,
  onExpandSidebar
}: {
  expanded: boolean
  title: string
  tabs?: Array<{ id: string; title: string }> | undefined
  activeTabId?: string | null | undefined
  onNewTab?: (() => void) | undefined
  onSelectTab?: ((id: string) => void) | undefined
  onCloseTab?: ((id: string) => void) | undefined
  onModeChange(mode: TaskLayoutMode): void
  sidebarCollapsed?: boolean
  onExpandSidebar?: (() => void) | undefined
}) {
  return (
    <div className={`browser-tabbar${expanded && sidebarCollapsed ? ' has-sidebar-restore' : ''}`}>
      {expanded && sidebarCollapsed && onExpandSidebar ? (
        <SidebarRestoreButton onClick={onExpandSidebar} />
      ) : null}
      {tabs ? <div className="browser-tabs" role="tablist">{tabs.map((tab) =>
        <div className={`browser-tab${tab.id === activeTabId ? ' is-active' : ''}`} key={tab.id}>
          <button type="button" role="tab" data-testid="e2e/tasks/detail/browser/tab#button" aria-selected={tab.id === activeTabId}
            onClick={() => onSelectTab?.(tab.id)}><AppIcon name="globe" />
            <span>{tab.title || '新标签页'}</span></button>
          <button type="button" data-testid="e2e/tasks/detail/browser/close-tab#button" aria-label={`关闭 ${tab.title || '新标签页'}`}
            onClick={() => onCloseTab?.(tab.id)}><AppIcon name="close" /></button>
        </div>)}</div> : <div className="browser-tab">
          <AppIcon name="globe" />
          <span>{expanded ? '新标签页' : title}</span>
          <AppIcon name="close" />
        </div>}
      <IconButton
        className="browser-plain-button"
        icon="plus"
        aria-label="新建标签页"
        testId="e2e/tasks/detail/browser/new-tab#button"
        onClick={onNewTab}
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
