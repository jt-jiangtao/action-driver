import type { BrowserSkillProjection } from '@actiondriver/contracts'
import { useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Globe2,
  Hand,
  LockKeyhole,
  Maximize2,
  Minimize2,
  MoreVertical,
  PanelRight,
  Pause,
  Play,
  Plus,
  RotateCw,
  X
} from 'lucide-react'
import hotelSearch from '../assets/hotel-search.png'

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
      <div className="browser-tabbar">
        <div className="browser-tab">
          <Globe2 />
          <span>{expanded ? '新标签页' : projection.title}</span>
          <X />
        </div>
        <button className="browser-plain-button" aria-label="新建标签页">
          <Plus />
        </button>
        <div className="browser-window-actions">
          <button
            className="browser-plain-button"
            aria-label={expanded ? '缩小浏览器' : '放大浏览器'}
            onClick={() => onModeChange(expanded ? 'split' : 'browser-expanded')}
          >
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </button>
          <button
            className="browser-plain-button"
            aria-label="折叠浏览器"
            onClick={() => onModeChange('browser-collapsed')}
          >
            <PanelRight />
          </button>
        </div>
      </div>

      <div className="browser-navbar">
        <button className="browser-plain-button" aria-label="后退">
          <ChevronLeft />
        </button>
        <button className="browser-plain-button" aria-label="前进">
          <ChevronRight />
        </button>
        <button className="browser-plain-button" aria-label="刷新">
          <RotateCw />
        </button>
        <div className="browser-address">
          {expanded ? null : <LockKeyhole />}
          <span>{expanded ? '搜索或输入网址' : projection.url}</span>
        </div>
        {expanded ? (
          <button className="browser-plain-button" aria-label="浏览器菜单">
            <MoreVertical />
          </button>
        ) : null}
      </div>

      <div className="browser-content">
        {expanded ? (
          <div className="browser-empty-state">
            <Globe2 />
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

function BrowserSkillControls({
  status,
  onPause,
  onResume,
  onTakeOver
}: {
  status: BrowserSkillProjection['status']
  onPause(): Promise<unknown> | void
  onResume(): Promise<unknown> | void
  onTakeOver(): Promise<unknown> | void
}) {
  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const takenOver = status === 'taken-over'
  const paused = status === 'paused'
  const resumable = paused || takenOver || status === 'queued' || status === 'waiting-user'
  const terminal = status === 'succeeded' || status === 'failed'
  const labels: Record<BrowserSkillProjection['status'], string> = {
    queued: 'Browser Skill · 等待开始',
    running: 'Browser Skill · 运行中',
    paused: 'Browser Skill · 已暂停',
    'waiting-user': 'Browser Skill · 等待用户',
    'taken-over': 'Browser Skill · 人工接管中',
    succeeded: 'Browser Skill · 已完成',
    failed: 'Browser Skill · 已中断'
  }
  const runTransition = async (transition: () => Promise<unknown> | void) => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try {
      await transition()
    } catch {
      // The session projection remains authoritative when a stale control command is rejected.
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }
  return (
    <div className={`browser-skill-controls is-${status}`} aria-busy={pending}>
      <span className="browser-skill-status">
        <i />
        {labels[status]}
      </span>
      {terminal ? null : <span className="control-divider" />}
      {resumable ? (
        <button
          className="skill-control-button"
          disabled={pending}
          onClick={() => void runTransition(onResume)}
        >
          <Play />
          继续 Agent
        </button>
      ) : status === 'running' ? (
        <button
          className="skill-control-button"
          disabled={pending}
          onClick={() => void runTransition(onPause)}
        >
          <Pause />
          暂停
        </button>
      ) : null}
      {status === 'running' || paused || takenOver ? (
        <button
          className={`skill-control-button take-over ${takenOver ? 'is-active' : ''}`}
          disabled={takenOver || pending}
          onClick={() => void runTransition(onTakeOver)}
        >
          <Hand />
          人工接管
        </button>
      ) : null}
    </div>
  )
}
