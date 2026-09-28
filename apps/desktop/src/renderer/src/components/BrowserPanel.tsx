import type { BrowserSkillProjection } from '@actiondriver/contracts'
import type { BrowserSessionCommand, BrowserSessionControl } from '@actiondriver/browser-desktop'
import { useEffect, useRef } from 'react'
import hotelSearch from '../assets/hotel-search.png'
import { BrowserNavigationBar } from './browser/BrowserNavigationBar'
import { BrowserSkillControls } from './browser/BrowserSkillControls'
import { BrowserTabBar } from './browser/BrowserTabBar'
import { AppIcon } from './ui/AppIcon'

export type TaskLayoutMode = 'split' | 'browser-expanded' | 'browser-collapsed'

export function BrowserPanel({
  mode,
  sidebarCollapsed = false,
  onExpandSidebar,
  taskId,
  projection,
  onModeChange,
  onPause,
  onResume,
  onTakeOver
}: {
  mode: Exclude<TaskLayoutMode, 'browser-collapsed'>
  sidebarCollapsed?: boolean
  onExpandSidebar?: (() => void) | undefined
  taskId?: string | undefined
  projection: BrowserSkillProjection
  onModeChange(mode: TaskLayoutMode): void
  onPause(): Promise<unknown> | void
  onResume(): Promise<unknown> | void
  onTakeOver(): Promise<unknown> | void
}) {
  const expanded = mode === 'browser-expanded'
  const live = Boolean(taskId && projection.sessionId)
  const contentRef = useRef<HTMLDivElement>(null)
  const sessionId = projection.sessionId
  const tabId = projection.activeTabId
  useEffect(() => {
    if (!live || projection.surface !== 'embedded' || !taskId || !sessionId) return
    const element = contentRef.current
    const api = window.actionDriverDesktop?.browserSession
    if (!element || !api) return
    const update = (visible: boolean) => {
      const rect = element.getBoundingClientRect()
      void api.setViewport({ taskId, sessionId, bounds: {
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height)
      }, visible }).catch(() => {})
    }
    update(true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => update(true))
    observer?.observe(element)
    window.addEventListener('resize', updateOnResize)
    function updateOnResize() { update(true) }
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateOnResize)
      update(false)
    }
  }, [live, mode, projection.surface, sessionId, taskId])
  const execute = (command: BrowserSessionCommand) => {
    if (!taskId || !sessionId || !tabId) return
    void window.actionDriverDesktop?.browserSession.command({
      action: 'execute', taskId, sessionId, tabId, command
    })
  }
  const transition = async (control: BrowserSessionControl,
    next: () => Promise<unknown> | void) => {
    if (taskId && sessionId)
      await window.actionDriverDesktop?.browserSession.command({
        action: 'transition', taskId, sessionId, control
      })
    return next()
  }
  return (
    <section className={`browser-panel browser-panel-${mode}${live ? ' browser-panel-live' : ''}`}
      aria-label={live ? '内嵌浏览器' : '内嵌浏览器占位'}>
      <BrowserTabBar
        expanded={expanded}
        title={projection.title}
        tabs={live ? projection.tabs : undefined}
        activeTabId={tabId}
        onNewTab={live ? () => execute({ type: 'create-tab' }) : undefined}
        onSelectTab={live ? (id) => {
          if (!taskId || !sessionId) return
          void window.actionDriverDesktop?.browserSession.command({
            action: 'execute', taskId, sessionId, tabId: id, command: { type: 'select-tab' }
          })
        } : undefined}
        onCloseTab={live ? (id) => {
          if (!taskId || !sessionId) return
          void window.actionDriverDesktop?.browserSession.command({
            action: 'execute', taskId, sessionId, tabId: id, command: { type: 'close-tab' }
          })
        } : undefined}
        onModeChange={onModeChange}
        sidebarCollapsed={sidebarCollapsed}
        onExpandSidebar={onExpandSidebar}
      />
      <BrowserNavigationBar expanded={expanded} url={projection.url}
        live={live} canGoBack={projection.tabs?.find(tab => tab.id === tabId)?.canGoBack ?? false}
        canGoForward={projection.tabs?.find(tab => tab.id === tabId)?.canGoForward ?? false}
        onBack={() => execute({ type: 'back' })} onForward={() => execute({ type: 'forward' })}
        onRefresh={() => execute({ type: 'refresh' })}
        onNavigate={(url) => execute({ type: 'navigate', url })} />
      {live && projection.error ? <div className="browser-session-error" role="alert">
        {projection.error}
      </div> : null}
      <div className="browser-content" ref={contentRef}>
        {live && projection.surface === 'external-chrome' ? (
          <div className="browser-empty-state">
            <AppIcon name="globe" />
            <strong>Chrome 已在独立窗口打开</strong>
            <span>Agent 正在此会话中操作页面</span>
          </div>
        ) : live ? null : expanded ? (
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
        {live ? null : <BrowserSkillControls
          status={projection.status}
          onPause={onPause}
          onResume={onResume}
          onTakeOver={onTakeOver}
        />}
      </div>
      {live ? <div className="browser-control-footer"><BrowserSkillControls
        status={projection.status}
        onPause={() => transition('pause', onPause)}
        onResume={() => transition('resume', onResume)}
        onTakeOver={() => transition('take-over', onTakeOver)}
      /></div> : null}
    </section>
  )
}
