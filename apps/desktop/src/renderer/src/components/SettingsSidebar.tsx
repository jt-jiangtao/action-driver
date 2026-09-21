import { ActionDriverLogo } from './ActionDriverLogo'
import { AppIcon } from './ui/AppIcon'

export function SettingsSidebar({ onBack }: { onBack(): void }) {
  return (
    <aside className="settings-sidebar">
      <div className="settings-drag-space" aria-hidden="true" />
      <button className="settings-back" type="button" onClick={onBack}>
        <AppIcon name="arrow-left" />
        返回应用
      </button>
      <label className="settings-search">
        <AppIcon name="search" />
        <input type="search" aria-label="搜索设置" placeholder="搜索设置" />
      </label>
      <div className="settings-nav-group">
        <span className="settings-nav-label">模型</span>
        <button className="settings-nav-item is-active" type="button">
          <AppIcon name="network" />
          模型连接
        </button>
      </div>
      <div className="settings-brand">
        <ActionDriverLogo size={18} />
        <strong>ActionDriver</strong>
      </div>
    </aside>
  )
}
