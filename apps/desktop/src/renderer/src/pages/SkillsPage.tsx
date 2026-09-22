import { useCallback, useEffect, useState } from 'react'
import { SettingsSidebar } from '../components/SettingsSidebar'
import {
  AgentMarkdownEditor,
  type EditorSaveState
} from '../components/settings/AgentMarkdownEditor'
import { AppIcon } from '../components/ui/AppIcon'
import type {
  AgentFileNode,
  AgentFilesService,
  AgentSkillSummary,
  AgentTextFile
} from '../models/agent-files'
import { e2eId } from '../testing/e2e-id'

function FileTree({
  nodes,
  selectedPath,
  onSelect,
  nested = false
}: {
  nodes: AgentFileNode[]
  selectedPath: string | null
  onSelect(path: string): void
  nested?: boolean
}) {
  return (
    <ul
      className="skill-file-tree"
      role={nested ? 'group' : 'tree'}
      {...(!nested ? { 'aria-label': 'Skill 文件' } : {})}
    >
      {nodes.map((node) => (
        <li key={node.path} role="none">
          {node.kind === 'file' ? (
            <button
              type="button"
              data-testid={e2eId('e2e/settings/skills/files/:path#button', {
                path: encodeURIComponent(node.path)
              })}
              role="treeitem"
              aria-selected={selectedPath === node.path}
              className={selectedPath === node.path ? 'is-selected' : ''}
              onClick={() => onSelect(node.path)}
            >
              <AppIcon name="code" />
              <span>{node.name}</span>
            </button>
          ) : (
            <>
              <div className="skill-tree-folder" role="treeitem" aria-expanded="true">
                <AppIcon name="chevron-down" />
                <AppIcon name="folder" />
                <span>{node.name}</span>
              </div>
              {node.children ? (
                <div className="skill-tree-children">
                  <FileTree
                    nodes={node.children}
                    selectedPath={selectedPath}
                    onSelect={onSelect}
                    nested
                  />
                </div>
              ) : null}
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

export function SkillsPage({
  service,
  onBack,
  onOpenConnections,
  onOpenMainPrompt,
  onOpenLogs
}: {
  service: AgentFilesService
  onBack(): void
  onOpenConnections?(): void
  onOpenMainPrompt?(): void
  onOpenLogs?(): void
}) {
  const [skills, setSkills] = useState<AgentSkillSummary[] | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<AgentSkillSummary | null>(null)
  const [tree, setTree] = useState<AgentFileNode[]>([])
  const [file, setFile] = useState<AgentTextFile | null>(null)
  const [value, setValue] = useState('')
  const [saveState, setSaveState] = useState<EditorSaveState>('saved')
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<'create' | 'rename' | 'delete' | null>(null)
  const [dialogName, setDialogName] = useState('')
  const [dialogDescription, setDialogDescription] = useState('')
  const [dialogBusy, setDialogBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [pendingSkillId, setPendingSkillId] = useState<string | null>(null)

  const loadSkills = useCallback(async () => {
    try {
      const nextSkills = await service.listSkills()
      setSkills(nextSkills)
      setError(null)
      return nextSkills
    } catch (loadError) {
      setSkills([])
      setError(loadError instanceof Error ? loadError.message : String(loadError))
      return []
    }
  }, [service])

  useEffect(() => {
    void loadSkills()
  }, [loadSkills])

  const openFile = async (path: string) => {
    try {
      const nextFile = await service.readFile(path)
      setFile(nextFile)
      setValue(nextFile.content)
      setSaveState('saved')
      setError(null)
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : String(readError))
    }
  }

  const openSkill = async (skill: AgentSkillSummary) => {
    try {
      const nextTree = await service.getSkillTree(skill.id)
      setSelectedSkill(skill)
      setTree(nextTree)
      const firstFile = nextTree.find((node) => node.kind === 'file')
      if (firstFile) await openFile(firstFile.path)
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError))
    }
  }

  const visibleSkills = (skills ?? []).filter((skill) =>
    `${skill.name} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase())
  )
  const normalizedDialogName = dialogName.trim().toLowerCase()
  const dialogNameError =
    dialogName.length > 0 && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dialogName.trim())
      ? '仅支持小写英文、数字和单个连字符'
      : null

  const closeDialog = () => {
    if (dialogBusy) return
    setDialog(null)
    setDialogName('')
    setDialogDescription('')
    setDialogError(null)
  }

  const submitDialog = async () => {
    setDialogBusy(true)
    setDialogError(null)
    try {
      if (dialog === 'create') {
        await service.createSkill({ name: dialogName, description: dialogDescription })
        await loadSkills()
      } else if (dialog === 'rename' && selectedSkill) {
        const renamed = await service.renameSkill(selectedSkill.id, dialogName)
        setSelectedSkill(renamed)
        await loadSkills()
      } else if (dialog === 'delete' && selectedSkill) {
        await service.deleteSkill(selectedSkill.id)
        setSelectedSkill(null)
        setFile(null)
        await loadSkills()
      }
      setDialogBusy(false)
      closeDialog()
    } catch (dialogSubmitError) {
      setDialogError(
        dialogSubmitError instanceof Error ? dialogSubmitError.message : String(dialogSubmitError)
      )
    } finally {
      setDialogBusy(false)
    }
  }

  return (
    <div className="settings-shell" data-testid="e2e/settings/skills/page#page">
      <SettingsSidebar
        onBack={onBack}
        active="skills"
        {...(onOpenConnections ? { onOpenConnections } : {})}
        {...(onOpenMainPrompt ? { onOpenMainPrompt } : {})}
        {...(onOpenLogs ? { onOpenLogs } : {})}
      />
      <main className="settings-main agent-settings-main">
        <div className={`agent-page ${selectedSkill ? 'is-skill-detail' : ''}`}>
          {selectedSkill ? (
            <>
              <header className="agent-page-header skill-detail-header">
                <div>
                  <button
                    className="agent-back-link"
                    data-testid="e2e/settings/skills/detail/back#button"
                    type="button"
                    onClick={async () => {
                      setSelectedSkill(null)
                      setFile(null)
                      await loadSkills()
                    }}
                  >
                    <AppIcon name="arrow-left" />
                    返回 Skills
                  </button>
                  <h1>{selectedSkill.name}</h1>
                  <p>{selectedSkill.description}</p>
                </div>
                <div className="skill-detail-actions">
                  <button
                    className="plain-icon-action"
                    data-testid="e2e/settings/skills/detail/actions#button"
                    type="button"
                    aria-label="Skill 操作"
                    title="Skill 操作"
                    aria-expanded={actionMenuOpen}
                    onClick={() => setActionMenuOpen((open) => !open)}
                  >
                    <AppIcon name="more-vertical" />
                  </button>
                  {actionMenuOpen ? (
                    <div className="skill-action-menu" role="menu">
                      <button
                        data-testid="e2e/settings/skills/detail/rename#menuitem"
                        type="button"
                        role="menuitem"
                        disabled={selectedSkill.protected}
                        onClick={() => {
                          setActionMenuOpen(false)
                          setDialogName(selectedSkill.name)
                          setDialog('rename')
                        }}
                      >
                        重命名
                      </button>
                      <button
                        data-testid="e2e/settings/skills/detail/delete#menuitem"
                        type="button"
                        role="menuitem"
                        disabled={selectedSkill.protected}
                        onClick={() => {
                          setActionMenuOpen(false)
                          setDialog('delete')
                        }}
                      >
                        删除 Skill
                      </button>
                      {selectedSkill.protected ? <span>内置 Skill 受保护</span> : null}
                    </div>
                  ) : null}
                </div>
              </header>
              <div className="skill-workspace">
                <aside className="skill-tree-panel">
                  <div className="skill-tree-heading">
                    <strong>文件</strong>
                  </div>
                  <FileTree
                    nodes={tree}
                    selectedPath={file?.path ?? null}
                    onSelect={(path) => void openFile(path)}
                  />
                </aside>
                <div className="skill-editor-pane">
                  {file ? (
                    <AgentMarkdownEditor
                      path={file.path}
                      value={value}
                      saveState={saveState}
                      ariaLabel="Skill Markdown"
                      onChange={(nextValue) => {
                        setValue(nextValue)
                        setSaveState(nextValue === file.content ? 'saved' : 'dirty')
                      }}
                      onSave={async () => {
                        setSaveState('saving')
                        try {
                          const saved = await service.saveFile({
                            path: file.path,
                            content: value,
                            expectedDigest: file.digest
                          })
                          setFile(saved)
                          setValue(saved.content)
                          setError(null)
                          if (saved.path.endsWith('/SKILL.md')) {
                            const nextSkills = await loadSkills()
                            const refreshed = nextSkills.find(
                              (skill) => skill.id === selectedSkill.id
                            )
                            if (refreshed) setSelectedSkill(refreshed)
                          }
                          setSaveState('saved')
                        } catch (saveError) {
                          setSaveState('error')
                          setError(
                            saveError instanceof Error ? saveError.message : String(saveError)
                          )
                        }
                      }}
                    />
                  ) : (
                    <div className="agent-loading">选择文件以开始编辑。</div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <header className="agent-page-header">
                <div>
                  <h1>Skills</h1>
                  <p>管理 Agent 可使用的本地能力与指令文件。</p>
                </div>
                <button
                  className="agent-primary-button"
                  data-testid="e2e/settings/skills/create#button"
                  type="button"
                  onClick={() => setDialog('create')}
                >
                  <AppIcon name="plus" />
                  新建 Skill
                </button>
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
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <span>{visibleSkills.length} 个 Skill</span>
              </div>
              {skills === null ? (
                <div className="agent-loading">正在读取 Skills…</div>
              ) : error ? (
                <div className="agent-state-error" role="alert">
                  <AppIcon name="circle-alert" size={22} />
                  <strong>无法读取 Skills</strong>
                  <span>{error}</span>
                  <button
                    className="agent-secondary-button"
                    data-testid="e2e/settings/skills/retry#button"
                    type="button"
                    onClick={() => void loadSkills()}
                  >
                    重试
                  </button>
                </div>
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
                        onClick={() => void openSkill(skill)}
                        aria-label={`打开 ${skill.name}`}
                      >
                        <span className="skill-row-icon">
                          <AppIcon name="skill" />
                        </span>
                        <span className="skill-row-copy">
                          <strong>{skill.name}</strong>
                          <span>{skill.description}</span>
                        </span>
                      </button>
                      <span
                        className={`skill-availability ${skill.available ? '' : 'is-unavailable'}`}
                      >
                        {skill.available ? (skill.enabled ? '已启用' : '已停用') : '不可用'}
                      </span>
                      <time dateTime={skill.modifiedAt}>
                        {new Date(skill.modifiedAt).toLocaleDateString('zh-CN')}
                      </time>
                      <button
                        className={`skill-toggle ${skill.enabled ? 'is-on' : ''}`}
                        data-testid={e2eId('e2e/settings/skills/toggles/:skill-id#switch', {
                          'skill-id': skill.id
                        })}
                        type="button"
                        role="switch"
                        aria-checked={skill.enabled}
                        aria-label={`${skill.enabled ? '停用' : '启用'} ${skill.name}`}
                        disabled={!skill.available || pendingSkillId === skill.id}
                        onClick={async () => {
                          const previousSkills = skills
                          setPendingSkillId(skill.id)
                          setSkills(
                            (current) =>
                              current?.map((item) =>
                                item.id === skill.id ? { ...item, enabled: !item.enabled } : item
                              ) ?? current
                          )
                          try {
                            await service.setSkillEnabled(skill.id, !skill.enabled)
                            await loadSkills()
                          } catch (toggleError) {
                            setSkills(previousSkills)
                            setError(
                              toggleError instanceof Error
                                ? toggleError.message
                                : String(toggleError)
                            )
                          } finally {
                            setPendingSkillId(null)
                          }
                        }}
                        aria-busy={pendingSkillId === skill.id}
                      >
                        <span />
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
          {error && (selectedSkill || skills === null) ? (
            <div className="agent-inline-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      </main>
      {dialog ? (
        <div className="agent-dialog-backdrop" role="presentation">
          <section
            className={`agent-dialog ${dialog === 'delete' ? 'is-confirm' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-dialog-title"
          >
            <header>
              <div>
                <h2 id="agent-dialog-title">
                  {dialog === 'create'
                    ? '新建 Skill'
                    : dialog === 'rename'
                      ? '重命名 Skill'
                      : '删除 Skill'}
                </h2>
                <p>
                  {dialog === 'create'
                    ? '将在 .action-driver/skills 中创建对应目录。'
                    : dialog === 'rename'
                      ? '修改 Skill 在列表中显示的名称。'
                      : `确定删除 ${selectedSkill?.name ?? ''}？此操作不可撤销。`}
                </p>
              </div>
              <button
                className="plain-icon-action"
                data-testid="e2e/settings/skills/dialog/close#button"
                type="button"
                aria-label="关闭"
                onClick={closeDialog}
              >
                <AppIcon name="close" />
              </button>
            </header>
            {dialog !== 'delete' ? (
              <div className="agent-dialog-fields">
                <label>
                  <span>Skill 名称</span>
                  <input
                    data-testid="e2e/settings/skills/dialog/name#input"
                    name="skill-name"
                    autoComplete="off"
                    aria-label="Skill 名称"
                    aria-invalid={Boolean(dialogNameError)}
                    value={dialogName}
                    onChange={(event) => setDialogName(event.target.value)}
                    placeholder="example-skill"
                  />
                  {dialogNameError ? (
                    <small className="agent-field-error">{dialogNameError}</small>
                  ) : null}
                </label>
                {dialog === 'create' ? (
                  <label>
                    <span>Skill 描述</span>
                    <textarea
                      data-testid="e2e/settings/skills/dialog/description#textarea"
                      name="skill-description"
                      aria-label="Skill 描述"
                      value={dialogDescription}
                      onChange={(event) => setDialogDescription(event.target.value)}
                      placeholder="说明这个 Skill 在什么情况下使用"
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            {dialogError ? (
              <p className="agent-dialog-error" role="alert">
                {dialogError}
              </p>
            ) : null}
            <footer>
              <button
                className="agent-secondary-button"
                data-testid="e2e/settings/skills/dialog/cancel#button"
                type="button"
                onClick={closeDialog}
                disabled={dialogBusy}
              >
                取消
              </button>
              <button
                className={dialog === 'delete' ? 'agent-danger-button' : 'agent-primary-button'}
                data-testid="e2e/settings/skills/dialog/submit#button"
                type="button"
                onClick={() => void submitDialog()}
                disabled={
                  dialogBusy ||
                  (dialog !== 'delete' && (!normalizedDialogName || Boolean(dialogNameError)))
                }
              >
                {dialogBusy
                  ? '处理中…'
                  : dialog === 'create'
                    ? '创建 Skill'
                    : dialog === 'rename'
                      ? '保存名称'
                      : '确认删除'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}
