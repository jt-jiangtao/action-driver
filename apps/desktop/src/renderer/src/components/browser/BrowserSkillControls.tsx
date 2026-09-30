import type { BrowserSkillProjection } from '@action-driver/contracts'
import { useRef, useState } from 'react'
import { AppIcon } from '../ui/AppIcon'

export function BrowserSkillControls({
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
    <div
      aria-busy={pending}
      aria-label="Browser Skill 控制"
      className={`browser-skill-controls is-${status}`}
    >
      <span className="browser-skill-status"><i />{labels[status]}</span>
      {terminal ? null : <span className="control-divider" />}
      {resumable ? (
        <button
          className="skill-control-button"
          data-testid="e2e/tasks/detail/browser/resume#button"
          disabled={pending}
          onClick={() => void runTransition(onResume)}
        >
          <AppIcon name="play" />继续 Agent
        </button>
      ) : status === 'running' ? (
        <button
          className="skill-control-button"
          data-testid="e2e/tasks/detail/browser/pause#button"
          disabled={pending}
          onClick={() => void runTransition(onPause)}
        >
          <AppIcon name="pause" />暂停
        </button>
      ) : null}
      {status === 'running' || paused || takenOver ? (
        <button
          className={`skill-control-button take-over ${takenOver ? 'is-active' : ''}`}
          data-testid="e2e/tasks/detail/browser/take-over#button"
          disabled={takenOver || pending}
          onClick={() => void runTransition(onTakeOver)}
        >
          <AppIcon name="takeover" />人工接管
        </button>
      ) : null}
    </div>
  )
}
