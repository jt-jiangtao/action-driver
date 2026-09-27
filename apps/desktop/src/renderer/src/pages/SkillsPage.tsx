import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SettingsSidebar } from '../components/SettingsSidebar'
import {
  AgentMarkdownEditor,
  type EditorSaveState
} from '../components/settings/AgentMarkdownEditor'
import { AppIcon } from '../components/ui/AppIcon'
import { MarkdownContent } from '../components/MarkdownContent'
import type {
  AgentFileNode,
  AgentFilesService,
  AgentSkillSummary,
  AgentTextFile
} from '../models/agent-files'
import { e2eId } from '../testing/e2e-id'

function skillSourceLabel(source: AgentSkillSummary['source']): string {
  return source === 'plugin' ? '插件' : source === 'builtin' ? '系统' : source === 'github' ? 'GitHub' : '个人'
}

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
  onOpenComputerUse
}: {
  service: AgentFilesService
  onBack(): void
  onOpenConnections?(): void
  onOpenMainPrompt?(): void
  onOpenComputerUse?(): void
}) {
  const queryClient = useQueryClient()
  const [skills, setSkills] = useState<AgentSkillSummary[] | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<AgentSkillSummary | null>(null)
  const [tree, setTree] = useState<AgentFileNode[]>([])
  const [file, setFile] = useState<AgentTextFile | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [saveState, setSaveState] = useState<EditorSaveState>('saved')
  const [error, setError] = useState<string | null>(null)
  const [listLoadError, setListLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<'create' | 'rename' | 'delete' | 'install-github' | null>(null)
  const [installUrl, setInstallUrl] = useState('')
  const [dialogName, setDialogName] = useState('')
  const [dialogDescription, setDialogDescription] = useState('')
  const [dialogBusy, setDialogBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [pendingSkillId, setPendingSkillId] = useState<string | null>(null)
  const detailRef = useRef<HTMLElement>(null)
  const lastTriggerRef = useRef<HTMLElement | null>(null)

  const loadSkills = useCallback(async (refresh = false) => {
    try {
      if (refresh) await queryClient.invalidateQueries({ queryKey: ['skills'], refetchType: 'none' })
      const nextSkills = await queryClient.fetchQuery({
        queryKey: ['skills'],
        queryFn: () => service.listSkills(),
        staleTime: 30_000,
        retry: false
      })
      setSkills(nextSkills)
      setListLoadError(null)
      setError(null)
      return nextSkills
    } catch (loadError) {
      setSkills([])
      setListLoadError(loadError instanceof Error ? loadError.message : String(loadError))
      return []
    }
  }, [queryClient, service])

  useEffect(() => {
    void loadSkills()
  }, [loadSkills])

  useEffect(() => {
    if (!selectedSkill || dialog) return
    const dialogElement = detailRef.current
    dialogElement?.querySelector<HTMLButtonElement>('[aria-label="关闭 Skill 详情"]')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeSkillDetail()
      } else if (event.key === 'Tab' && dialogElement) {
        const focusable = Array.from(dialogElement.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ))
        const first = focusable[0]
        const last = focusable.at(-1)
        if (!first || !last) return
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedSkill, dialog])

  const closeSkillDetail = () => {
    setSelectedSkill(null)
    setFile(null)
    setSelectedAsset(null)
    setActionMenuOpen(false)
    requestAnimationFrame(() => lastTriggerRef.current?.focus())
  }

  const openFile = async (path: string) => {
    if (/\.(?:png|jpe?g|gif|webp|ico|pdf|zip)$/i.test(path)) {
      setFile(null)
      setSelectedAsset(path)
      setError(null)
      return
    }
    try {
      const nextFile = await service.readFile(path)
      setFile(nextFile)
      setSelectedAsset(null)
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
      setSelectedAsset(null)
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
    setInstallUrl('')
    setDialogError(null)
  }

  const submitDialog = async () => {
    setDialogBusy(true)
    setDialogError(null)
    try {
      if (dialog === 'create') {
        await service.createSkill({ name: dialogName, description: dialogDescription })
        await loadSkills(true)
      } else if (dialog === 'install-github') {
        await service.installSkill({ source: 'github', url: installUrl.trim() })
        await loadSkills(true)
      } else if (dialog === 'rename' && selectedSkill) {
        const renamed = await service.renameSkill(selectedSkill.id, dialogName)
        setSelectedSkill(renamed)
        await loadSkills(true)
      } else if (dialog === 'delete' && selectedSkill) {
        await service.deleteSkill(selectedSkill.id)
        setSelectedSkill(null)
        setFile(null)
        await loadSkills(true)
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

  const installLocalSkill = async () => {
    setAddMenuOpen(false)
    try {
      const path = await service.chooseLocalSkillFolder()
      if (!path) return
      await service.installSkill({ source: 'local', path })
      await loadSkills(true)
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : String(installError))
    }
  }

  return (
    <div className="settings-shell" data-testid="e2e/settings/skills/page#page">
      <SettingsSidebar
        onBack={onBack}
        active="skills"
        {...(onOpenConnections ? { onOpenConnections } : {})}
        {...(onOpenMainPrompt ? { onOpenMainPrompt } : {})}
        {...(onOpenComputerUse ? { onOpenComputerUse } : {})}
      />
      <main className="settings-main agent-settings-main">
        <div className="agent-page">
          <div className="skill-list-content" inert={Boolean(selectedSkill)}>

              <header className="agent-page-header">
                <div>
                  <h1>Skills</h1>
                  <p>管理 Agent 可使用的本地能力与指令文件。</p>
                </div>
                <div className="skill-list-actions">
                  <button className="agent-secondary-button" type="button"
                    data-testid="e2e/settings/skills/browse#button"
                    onClick={() => {
                      void service.browseSkillDirectory().catch((browseError: unknown) => {
                        setError(browseError instanceof Error ? browseError.message : String(browseError))
                      })
                    }}>
                    浏览目录
                  </button>
                  <button className="agent-secondary-button"
                    data-testid="e2e/settings/skills/create#button"
                    type="button" onClick={() => setDialog('create')}>
                    新建 Skill
                  </button>
                  <div className="skill-add-menu-wrap">
                    <button className="agent-primary-button" type="button"
                      data-testid="e2e/settings/skills/add#button"
                      aria-expanded={addMenuOpen} onClick={() => setAddMenuOpen((open) => !open)}>
                      <AppIcon name="plus" />添加
                    </button>
                    {addMenuOpen ? <div className="skill-add-menu" role="menu">
                      <button type="button" role="menuitem" data-testid="e2e/settings/skills/add-github#menuitem" onClick={() => {
                        setAddMenuOpen(false)
                        setDialog('install-github')
                      }}>从 GitHub 安装</button>
                      <button type="button" role="menuitem" data-testid="e2e/settings/skills/add-local#menuitem" onClick={() => void installLocalSkill()}>
                        从本地文件夹安装
                      </button>
                    </div> : null}
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
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <span>{visibleSkills.length} 个 Skill</span>
              </div>
              {skills === null ? (
                <div className="agent-loading">正在读取 Skills…</div>
              ) : listLoadError && !selectedSkill ? (
                <div className="agent-state-error" role="alert">
                  <AppIcon name="circle-alert" size={22} />
                  <strong>无法读取 Skills</strong>
                  <span>{listLoadError}</span>
                  <button
                    className="agent-secondary-button"
                    data-testid="e2e/settings/skills/retry#button"
                    type="button"
                    onClick={() => void loadSkills(true)}
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
                        onClick={(event) => {
                          lastTriggerRef.current = event.currentTarget
                          void openSkill(skill)
                        }}
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
                        disabled={skill.source === 'plugin' || !skill.available || pendingSkillId === skill.id}
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
          </div>
          {selectedSkill ? (
            <div className="skill-detail-backdrop" role="presentation">
              <section ref={detailRef} className="skill-detail-dialog" role="dialog" aria-modal="true" aria-label={selectedSkill.name}>

              <header className="agent-page-header skill-detail-header">
                <div className="skill-detail-heading">
                  <span className="skill-detail-icon" aria-hidden="true"><AppIcon name="package" /></span>
                  <div>
                    <h1>{selectedSkill.name}<span>Skill</span></h1>
                    <p>{selectedSkill.description}</p>
                    <small>{skillSourceLabel(selectedSkill.source)} Skill</small>
                  </div>
                </div>
                <div className="skill-detail-actions">
                  <button className={`skill-toggle ${selectedSkill.enabled ? 'is-on' : ''}`}
                    data-testid="e2e/settings/skills/detail/toggle#switch"
                    type="button" role="switch" aria-checked={selectedSkill.enabled}
                    aria-label={`${selectedSkill.enabled ? '停用' : '启用'} ${selectedSkill.name}`}
                    disabled={selectedSkill.source === 'plugin' || !selectedSkill.available || pendingSkillId === selectedSkill.id}
                    onClick={async () => {
                      setPendingSkillId(selectedSkill.id)
                      try {
                        const updated = await service.setSkillEnabled(selectedSkill.id, !selectedSkill.enabled)
                        setSelectedSkill(updated)
                        await loadSkills(true)
                      } catch (toggleError) {
                        setError(toggleError instanceof Error ? toggleError.message : String(toggleError))
                      } finally { setPendingSkillId(null) }
                    }}><span /></button>
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
                      <button type="button" role="menuitem" data-testid="e2e/settings/skills/detail/reveal#menuitem" onClick={async () => {
                        setActionMenuOpen(false)
                        try { await service.revealSkillFolder(selectedSkill.id) }
                        catch (openError) { setError(openError instanceof Error ? openError.message : String(openError)) }
                      }}>在 Finder 中显示</button>
                      <button type="button" role="menuitem" data-testid="e2e/settings/skills/detail/copy#menuitem" onClick={async () => {
                        setActionMenuOpen(false)
                        try {
                          const entry = tree.find((node) => node.name === 'SKILL.md')
                          if (!entry) return
                          const markdown = await service.readFile(entry.path)
                          await navigator.clipboard.writeText(markdown.content)
                        } catch (copyError) { setError(copyError instanceof Error ? copyError.message : String(copyError)) }
                      }}>复制 Markdown</button>
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
                  <button className="plain-icon-action" type="button" aria-label="关闭 Skill 详情"
                    data-testid="e2e/settings/skills/detail/back#button"
                    onClick={closeSkillDetail}>
                    <AppIcon name="close" />
                  </button>
                </div>
              </header>
              <div className="skill-workspace">
                <aside className="skill-tree-panel">
                  <div className="skill-tree-heading">
                    <strong>文件</strong>
                  </div>
                  <FileTree
                    nodes={tree}
                    selectedPath={file?.path ?? selectedAsset}
                    onSelect={(path) => void openFile(path)}
                  />
                </aside>
                <div className="skill-editor-pane">
                  {file && selectedSkill.protected ? (
                    file.path.endsWith('.md') ? (
                      <MarkdownContent content={file.content} className="skill-readonly-content markdown-content" />
                    ) : (
                      <pre className="skill-readonly-content skill-code-content">{file.content}</pre>
                    )
                  ) : file ? (
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
                            const nextSkills = await loadSkills(true)
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
                  ) : selectedAsset ? (
                    <div className="skill-asset-notice">
                      <strong>此文件无法在这里预览</strong>
                      <span>{selectedAsset.split('/').at(-1)} 已保存在 Skill 目录中，可通过“在 Finder 中显示”查看。</span>
                    </div>
                  ) : (
                    <div className="agent-loading">选择文件以开始编辑。</div>
                  )}
                </div>
              </div>
              {error ? <div className="agent-inline-error skill-detail-error" role="alert">{error}</div> : null}
              {!selectedSkill.protected ? (
                <footer className="skill-detail-footer">
                  <button className="skill-uninstall-button" type="button" data-testid="e2e/settings/skills/detail/uninstall#button" onClick={() => setDialog('delete')}>
                    卸载
                  </button>
                </footer>
              ) : null}
              </section>
            </div>
          ) : null}
          {error && !selectedSkill ? (
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
                    : dialog === 'install-github'
                      ? '从 GitHub 安装 Skill'
                    : dialog === 'rename'
                      ? '重命名 Skill'
                      : '删除 Skill'}
                </h2>
                <p>
                  {dialog === 'create'
                    ? '将在 .action-driver/skills 中创建对应目录。'
                    : dialog === 'install-github'
                      ? '粘贴仓库地址或仓库中的 Skill 子目录地址。'
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
            {dialog === 'install-github' ? (
              <div className="agent-dialog-fields">
                <label>
                  <span>GitHub URL</span>
                  <input type="url" aria-label="GitHub URL" data-testid="e2e/settings/skills/dialog/github-url#input" value={installUrl}
                    placeholder="https://github.com/owner/repo/tree/main/skills/example"
                    onChange={(event) => setInstallUrl(event.target.value)} />
                </label>
              </div>
            ) : dialog !== 'delete' ? (
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
                  (dialog === 'install-github'
                    ? !installUrl.trim().startsWith('https://github.com/')
                    : dialog !== 'delete' && (!normalizedDialogName || Boolean(dialogNameError)))
                }
              >
                {dialogBusy
                  ? '处理中…'
                  : dialog === 'create'
                    ? '创建 Skill'
                    : dialog === 'install-github'
                      ? '安装 Skill'
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
