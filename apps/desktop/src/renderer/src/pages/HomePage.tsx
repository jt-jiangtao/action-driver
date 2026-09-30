import { ProductLogo } from '../components/ProductLogo'
import { AgentComposer } from '../components/AgentComposer'
import { AppNavigationControls } from '../components/navigation/AppNavigationControls'
import type { ModelSelectionProjection } from '../models/model-selection'
import type { ModelRef } from '@action-driver/contracts'

export function HomePage({
  modelSelection,
  onSelectModel,
  onSubmit,
  onRetryModels,
  sidebarCollapsed = false,
  onExpandSidebar
}: {
  modelSelection: ModelSelectionProjection
  onSelectModel(model: ModelRef): void
  onSubmit(goal: string): Promise<unknown> | void
  onRetryModels?(): void
  sidebarCollapsed?: boolean
  onExpandSidebar?: (() => void) | undefined
}) {
  return (
    <main className="home-page">
      <header className="home-topbar">
        {sidebarCollapsed && onExpandSidebar ? (
          <AppNavigationControls sidebar={{ collapsed: true, onToggle: onExpandSidebar }} />
        ) : null}
      </header>
      <div className="home-body">
        <section className="home-hero">
          <div className="home-logo-frame">
            <ProductLogo size={58} />
          </div>
          <div className="home-copy">
            <h1>我们应该在 Action-Driver 中做些什么？</h1>
            <p>描述目标，Agent 会使用所选模型完成任务并保留完整记录。</p>
          </div>
        </section>
        <div className="home-spacer" />
        <div data-testid="e2e/home/main/composer#section" data-width="720">
          {modelSelection.state === 'error' ? (
            <div className="model-selection-notice" role="alert">
              <span>模型加载失败</span>
              <button
                type="button"
                data-testid="e2e/home/main/retry-models#button"
                onClick={onRetryModels}
              >
                重试
              </button>
            </div>
          ) : null}
          {modelSelection.state === 'empty' ? (
            <div className="model-selection-notice" role="status">
              请先在设置中添加可用模型
            </div>
          ) : null}
          <AgentComposer
            modelSelection={modelSelection}
            disabled={!modelSelection.selected}
            onSelectModel={onSelectModel}
            onSubmit={onSubmit}
            width={720}
          />
        </div>
      </div>
    </main>
  )
}
