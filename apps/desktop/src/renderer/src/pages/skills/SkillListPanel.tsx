import { AppIcon } from '../../components/ui/AppIcon'
import type { AgentSkillSummary } from '../../models/agent-files'
import { e2eId } from '../../testing/e2e-id'
import { skillSourceLabel } from './skill-presentation'

export type SkillListPanelProps = {
  skills: AgentSkillSummary[] | null
  loadError: string | null
  query: string
  pendingSkillId: string | null
  addMenuOpen: boolean
  /** Keeps the repository list out of the tab order while the detail dialog owns focus. */
  inert: boolean
  onQueryChange(value: string): void
  onRetry(): void
  onBrowse(): void
  onCreate(): void
  onToggleAddMenu(open: boolean): void
  onInstallGithub(): void
  onInstallLocal(): void
  onOpenSkill(skill: AgentSkillSummary, trigger: HTMLElement): void
  onToggleSkill(skill: AgentSkillSummary): void
}

export function SkillListPanel(props: SkillListPanelProps) {
  const visibleSkills = (props.skills ?? []).filter((skill) =>
    `${skill.name} ${skill.description}`.toLowerCase().includes(props.query.trim().toLowerCase())
  )

  return (
    <div className="skill-list-content" inert={props.inert}>
      <header className="agent-page-header">
        <div>
          <h1>Skills</h1>
          <p>管理 Agent 可使用的本地能力与指令文件。</p>
        </div>
        <div className="skill-list-actions">
          <button
            className="agent-secondary-button"
            type="button"
            data-testid="e2e/settings/skills/browse#button"
            onClick={props.onBrowse}
          >
            浏览目录
          </button>
          <button
            className="agent-secondary-button"
            data-testid="e2e/settings/skills/create#button"
            type="button"
            onClick={props.onCreate}
          >
            新建 Skill
          </button>
          <div className="skill-add-menu-wrap">
            <button
              className="agent-primary-button"
              type="button"
              data-testid="e2e/settings/skills/add#button"
              aria-expanded={props.addMenuOpen}
              onClick={() => props.onToggleAddMenu(!props.addMenuOpen)}
            >
              <AppIcon name="plus" />
              添加
            </button>
            {props.addMenuOpen ? (
              <div className="skill-add-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  data-testid="e2e/settings/skills/add-github#menuitem"
                  onClick={props.onInstallGithub}
                >
                  从 GitHub 安装
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="e2e/settings/skills/add-local#menuitem"
                  onClick={props.onInstallLocal}
                >
                  从本地文件夹安装
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <div className="skills-toolbar">
        <label className="skills-search">
          <AppIcon name="search" />
          <input
            data-testid="e2e/settings/skills/search#input"
            name="skill-search"
            type="search"
            autoComplete="off"
            aria-label="搜索 Skills"
            placeholder="搜索 Skills"
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
          />
        </label>
        <span>{visibleSkills.length} 个 Skill</span>
      </div>
      {props.loadError ? (
        <div className="agent-state-error" role="alert">
          <AppIcon name="circle-alert" size={22} />
          <strong>无法读取 Skills</strong>
          <span>{props.loadError}</span>
          <button
            className="agent-secondary-button"
            data-testid="e2e/settings/skills/retry#button"
            type="button"
            onClick={props.onRetry}
          >
            重试
          </button>
        </div>
      ) : props.skills === null ? (
        <div className="agent-loading">正在读取 Skills…</div>
      ) : visibleSkills.length === 0 ? (
        <div className="agent-empty-state">
          <AppIcon name="skill" size={24} />
          <strong>没有匹配的 Skill</strong>
          <span>调整搜索条件或新建一个 Skill。</span>
        </div>
      ) : (
        <div className="skills-repository-list">
          {visibleSkills.map((skill) => (
            <article className="skill-repository-row" key={skill.id}>
              <button
                className="skill-open-button"
                data-testid={e2eId('e2e/settings/skills/items/:skill-id#button', {
                  'skill-id': skill.id
                })}
                type="button"
                onClick={(event) => props.onOpenSkill(skill, event.currentTarget)}
                aria-label={`打开 ${skill.name}`}
              >
                <span className="skill-row-icon">
                  <AppIcon name="package" />
                </span>
                <span className="skill-row-copy">
                  <strong>{skill.name}</strong>
                  <span>{skill.description}</span>
                </span>
              </button>
              <span className="skill-source">{skillSourceLabel(skill.source)}</span>
              {!skill.available ? <span className="skill-availability is-unavailable">不可用</span> : null}
              <button
                className={`skill-toggle ${skill.enabled ? 'is-on' : ''}`}
                data-testid={e2eId('e2e/settings/skills/toggles/:skill-id#switch', {
                  'skill-id': skill.id
                })}
                type="button"
                role="switch"
                aria-checked={skill.enabled}
                aria-label={`${skill.enabled ? '停用' : '启用'} ${skill.name}`}
                disabled={
                  skill.source === 'plugin' || !skill.available || props.pendingSkillId === skill.id
                }
                onClick={() => props.onToggleSkill(skill)}
                aria-busy={props.pendingSkillId === skill.id}
              >
                <span />
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
