import { AppIcon } from '../ui/AppIcon'
import { IconButton } from '../ui/IconButton'

export function BrowserNavigationBar({ expanded, url }: { expanded: boolean; url: string }) {
  return (
    <div className="browser-navbar">
      <IconButton className="browser-plain-button" icon="chevron-left" aria-label="后退" />
      <IconButton className="browser-plain-button" icon="chevron-right" aria-label="前进" />
      <IconButton className="browser-plain-button" icon="refresh" aria-label="刷新" />
      <div className="browser-address">
        {expanded ? null : <AppIcon name="lock" />}
        <span>{expanded ? '搜索或输入网址' : url}</span>
      </div>
      {expanded ? (
        <IconButton className="browser-plain-button" icon="more-vertical" aria-label="浏览器菜单" />
      ) : null}
    </div>
  )
}
