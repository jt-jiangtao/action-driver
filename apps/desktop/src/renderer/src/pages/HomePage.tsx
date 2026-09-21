import { PanelRight } from 'lucide-react'
import { ActionDriverLogo } from '../components/ActionDriverLogo'
import { AgentComposer } from '../components/AgentComposer'
import type { ModelSelectionProjection } from '../models/model-selection'

export function HomePage({
  modelSelection,
  onSelectModel,
  onSubmit
}: {
  modelSelection: ModelSelectionProjection
  onSelectModel(modelId: string): void
  onSubmit(goal: string): void
}) {
  return (
    <main className="home-page">
      <header className="home-topbar">
        <button
          className="icon-button"
          aria-label="展开浏览器"
          data-testid="e2e/home/header/expand-browser#button"
        >
          <PanelRight />
        </button>
      </header>
      <div className="home-body">
        <section className="home-hero">
          <div className="home-logo-frame">
            <ActionDriverLogo size={58} />
          </div>
          <div className="home-copy">
            <h1>我们应该在 ActionDriver 中做些什么？</h1>
            <p>描述目标，Agent 会观察、规划并在需要时调用内嵌浏览器。</p>
          </div>
        </section>
        <div className="home-spacer" />
        <div data-testid="e2e/home/main/composer#section" data-width="720">
          <AgentComposer
            modelSelection={modelSelection}
            onSelectModel={onSelectModel}
            onSubmit={onSubmit}
            width={720}
          />
        </div>
      </div>
    </main>
  )
}
