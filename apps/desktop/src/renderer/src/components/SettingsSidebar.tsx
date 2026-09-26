import { ActionDriverLogo } from './ActionDriverLogo'
import { AppIcon } from './ui/AppIcon'

export function SettingsSidebar({
  onBack,
  active = 'model-connections',
  onOpenConnections,
  onOpenMainPrompt,
  onOpenSkills,
  onOpenComputerUse
}: {
  onBack(): void
  active?: 'model-connections' | 'main-prompt' | 'skills' | 'computer-use'
  onOpenConnections?(): void
  onOpenMainPrompt?(): void
  onOpenSkills?(): void
  onOpenComputerUse?(): void
}) {
  return (
    <aside className="settings-sidebar">
      <div className="settings-drag-space" aria-hidden="true" />
      <button
        className="settings-back"
        data-testid="e2e/settings/sidebar/back#button"
        type="button"
        onClick={onBack}
      >
        <AppIcon name="arrow-left" />
        返回应用
      </button>
      <label className="settings-search">
        <AppIcon name="search" />
        <input
          type="search"
          aria-label="搜索设置"
          data-testid="e2e/settings/sidebar/search#input"
          placeholder="搜索设置"
        />
      </label>
      <nav className="settings-sidebar-nav" aria-label="设置导航">
      <div className="settings-nav-group">
        <span className="settings-nav-label">模型</span>
        <button
          className={`settings-nav-item ${active === 'model-connections' ? 'is-active' : ''}`}
          data-testid="e2e/settings/sidebar/model-connections#button"
          type="button"
          onClick={active === 'model-connections' ? undefined : onOpenConnections}
        >
          <AppIcon name="cable" />
          模型连接
        </button>
      </div>
      <div className="settings-nav-group">
        <span className="settings-nav-label">Agent</span>
        <button
          className={`settings-nav-item ${active === 'main-prompt' ? 'is-active' : ''}`}
          data-testid="e2e/settings/sidebar/main-prompt#button"
          type="button"
          onClick={active === 'main-prompt' ? undefined : onOpenMainPrompt}
        >
          <AppIcon name="code" />
          主提示词
        </button>
        <button
          className={`settings-nav-item ${active === 'skills' ? 'is-active' : ''}`}
          data-testid="e2e/settings/sidebar/skills#button"
          type="button"
          onClick={active === 'skills' ? undefined : onOpenSkills}
        >
          <AppIcon name="skill" />
          Skills
        </button>
        <button className="settings-nav-item" data-testid="e2e/settings/sidebar/mcp#button" type="button" disabled title="MCP 配置尚未开放">
          <AppIcon name="mcp" />
          MCP
          <span className="settings-nav-soon">稍后</span>
        </button>
        <button
          className={`settings-nav-item ${active === 'computer-use' ? 'is-active' : ''}`}
          data-testid="e2e/settings/sidebar/computer-use#button"
          type="button"
          onClick={active === 'computer-use' ? undefined : onOpenComputerUse}
        >
          <AppIcon name="monitor" />
          Computer Use
        </button>
      </div>
      </nav>
      <div className="settings-brand">
        <ActionDriverLogo size={18} />
        <strong>ActionDriver</strong>
      </div>
    </aside>
  )
}
