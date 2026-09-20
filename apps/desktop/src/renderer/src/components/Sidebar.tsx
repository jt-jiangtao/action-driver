import { Blocks, LoaderCircle, PanelLeft, Plus, Search, WandSparkles } from 'lucide-react'
import { ActionDriverLogo } from './ActionDriverLogo'

const recentTasks = [
  '预订周末去杭州的酒店',
  '整理产品研究资料',
  '比较三款显示器',
  '更新旅行清单',
  '汇总本周会议记录'
]

export function Sidebar({
  active,
  onNewTask,
  onOpenTask
}: {
  active: 'new' | 'task'
  onNewTask(): void
  onOpenTask?(taskId: string): void
}) {
  return (
    <aside className="sidebar" data-testid="sidebar" data-width="248">
      <div className="sidebar-window-row">
        <span className="traffic-light-spacer" aria-hidden="true" />
        <button className="icon-button sidebar-collapse" aria-label="折叠侧栏">
          <PanelLeft />
        </button>
      </div>

      <div className="sidebar-brand-row">
        <span className="sidebar-logo-slot">
          <ActionDriverLogo size={18} />
        </span>
        <strong>ActionDriver</strong>
        <button className="icon-button sidebar-search" aria-label="搜索">
          <Search />
        </button>
      </div>

      <nav className="sidebar-primary-nav" aria-label="主导航">
        <button
          className={`sidebar-nav-item ${active === 'new' ? 'is-active' : ''}`}
          onClick={onNewTask}
        >
          <Plus />
          <span>新任务</span>
        </button>
        <button className="sidebar-nav-item" type="button">
          <WandSparkles />
          <span>Skills</span>
        </button>
        <button className="sidebar-nav-item" type="button">
          <Blocks />
          <span>MCP</span>
        </button>
      </nav>

      <section className="sidebar-recents" aria-labelledby="recent-tasks-title">
        <h2 id="recent-tasks-title">最近任务</h2>
        <div className="recent-task-list">
          {recentTasks.map((task, index) => (
            <button
              className={`recent-task ${active === 'task' && index === 0 ? 'is-active' : ''}`}
              key={task}
              onClick={() => {
                if (index === 0) onOpenTask?.('hotel-task')
              }}
            >
              <span>{task}</span>
              {index === 0 ? <LoaderCircle aria-label="加载中" className="loading-icon" /> : null}
            </button>
          ))}
        </div>
      </section>
    </aside>
  )
}
