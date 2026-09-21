import type { BrowserSkillProjection } from '@actiondriver/contracts'
import hotelSearch from '../assets/hotel-search.png'
import { BrowserNavigationBar } from './browser/BrowserNavigationBar'
import { BrowserSkillControls } from './browser/BrowserSkillControls'
import { BrowserTabBar } from './browser/BrowserTabBar'
import { AppIcon } from './ui/AppIcon'

export type TaskLayoutMode = 'split' | 'browser-expanded' | 'browser-collapsed'

export function BrowserPanel({
  mode,
  projection,
  onModeChange,
  onPause,
  onResume,
  onTakeOver
}: {
  mode: Exclude<TaskLayoutMode, 'browser-collapsed'>
  projection: BrowserSkillProjection
  onModeChange(mode: TaskLayoutMode): void
  onPause(): Promise<unknown> | void
  onResume(): Promise<unknown> | void
  onTakeOver(): Promise<unknown> | void
}) {
  const expanded = mode === 'browser-expanded'
  return (
    <section className={`browser-panel browser-panel-${mode}`} aria-label="内嵌浏览器占位">
      <BrowserTabBar expanded={expanded} title={projection.title} onModeChange={onModeChange} />
      <BrowserNavigationBar expanded={expanded} url={projection.url} />
      <div className="browser-content">
        {expanded ? (
          <div className="browser-empty-state">
            <AppIcon name="globe" />
            <strong>开始浏览</strong>
            <span>输入 URL 以打开页面</span>
          </div>
        ) : (
          <>
            <img className="browser-raster" src={hotelSearch} alt="杭州酒店搜索结果" />
            {projection.target ? (
              <div
                className="browser-target"
                style={{
                  left: projection.target.x,
                  top: projection.target.y,
                  width: projection.target.width,
                  height: projection.target.height
                }}
              >
                <span>{projection.target.label}</span>
              </div>
            ) : null}
          </>
        )}
        <BrowserSkillControls
          status={projection.status}
          onPause={onPause}
          onResume={onResume}
          onTakeOver={onTakeOver}
        />
      </div>
    </section>
  )
}
