import { useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AgentMarkdownEditor, type EditorSaveState } from '../../components/settings/AgentMarkdownEditor'
import { AppIcon } from '../../components/ui/AppIcon'
import { MarkdownContent } from '../../components/MarkdownContent'
import type { AgentFileNode, AgentSkillSummary, AgentTextFile } from '../../models/agent-files'
import { SkillFileTree } from './SkillFileTree'
import { skillSourceLabel } from './skill-presentation'

export type SkillDetailDialogProps = {
  skill: AgentSkillSummary
  tree: AgentFileNode[]
  file: AgentTextFile | null
  selectedAsset: string | null
  value: string
  saveState: EditorSaveState
  error: string | null
  pendingSkillId: string | null
  actionMenuOpen: boolean
  onClose(): void
  onToggleEnabled(): void
  onToggleActionMenu(): void
  onReveal(): void
  onCopyMarkdown(): void
  onRename(): void
  onDelete(): void
  onOpenFile(path: string): void
  onChangeValue(nextValue: string): void
  onSave(): void
}

/**
 * Modal Skill detail. Radix owns focus: the close button takes focus on open, Tab stays inside
 * the dialog, Escape closes it, and focus returns to the row that opened it.
 */
export function SkillDetailDialog(props: SkillDetailDialogProps) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const { skill, file } = props

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <Dialog.Overlay className="skill-detail-backdrop" />
      <Dialog.Content
        className="skill-detail-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          closeButton.current?.focus()
        }}
      >
        <header className="agent-page-header skill-detail-header">
          <div className="skill-detail-heading">
            <span className="skill-detail-icon" aria-hidden="true">
              <AppIcon name="package" />
            </span>
            <div>
              <Dialog.Title asChild>
                <h1>
                  {skill.name}
                  <span aria-hidden="true">Skill</span>
                </h1>
              </Dialog.Title>
              <Dialog.Description asChild>
                <p>{skill.description}</p>
              </Dialog.Description>
              <small>{skillSourceLabel(skill.source)} Skill</small>
            </div>
          </div>
          <div className="skill-detail-actions">
            <button
              className={`skill-toggle ${skill.enabled ? 'is-on' : ''}`}
              data-testid="e2e/settings/skills/detail/toggle#switch"
              type="button"
              role="switch"
              aria-checked={skill.enabled}
              aria-label={`${skill.enabled ? '停用' : '启用'} ${skill.name}`}
              disabled={
                skill.source === 'plugin' ||
                !skill.available ||
                props.pendingSkillId === skill.id
              }
              onClick={props.onToggleEnabled}
            >
              <span />
            </button>
            <button
              className="plain-icon-action"
              data-testid="e2e/settings/skills/detail/actions#button"
              type="button"
              aria-label="Skill 操作"
              title="Skill 操作"
              aria-expanded={props.actionMenuOpen}
              onClick={props.onToggleActionMenu}
            >
              <AppIcon name="more-vertical" />
            </button>
            {props.actionMenuOpen ? (
              <div className="skill-action-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  data-testid="e2e/settings/skills/detail/reveal#menuitem"
                  onClick={props.onReveal}
                >
                  在 Finder 中显示
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="e2e/settings/skills/detail/copy#menuitem"
                  onClick={props.onCopyMarkdown}
                >
                  复制 Markdown
                </button>
                <button
                  data-testid="e2e/settings/skills/detail/rename#menuitem"
                  type="button"
                  role="menuitem"
                  disabled={skill.protected}
                  onClick={props.onRename}
                >
                  重命名
                </button>
                <button
                  data-testid="e2e/settings/skills/detail/delete#menuitem"
                  type="button"
                  role="menuitem"
                  disabled={skill.protected}
                  onClick={props.onDelete}
                >
                  删除 Skill
                </button>
                {skill.protected ? <span>内置 Skill 受保护</span> : null}
              </div>
            ) : null}
            <button
              ref={closeButton}
              className="plain-icon-action"
              type="button"
              aria-label="关闭 Skill 详情"
              data-testid="e2e/settings/skills/detail/back#button"
              onClick={props.onClose}
            >
              <AppIcon name="close" />
            </button>
          </div>
        </header>
        <div className="skill-workspace">
          <aside className="skill-tree-panel">
            <div className="skill-tree-heading">
              <strong>文件</strong>
            </div>
            <SkillFileTree
              nodes={props.tree}
              selectedPath={file?.path ?? props.selectedAsset}
              onSelect={props.onOpenFile}
            />
          </aside>
          <div className="skill-editor-pane">
            {file && skill.protected ? (
              file.path.endsWith('.md') ? (
                <MarkdownContent
                  content={file.content}
                  className="skill-readonly-content markdown-content"
                />
              ) : (
                <pre className="skill-readonly-content skill-code-content">{file.content}</pre>
              )
            ) : file ? (
              <AgentMarkdownEditor
                path={file.path}
                value={props.value}
                saveState={props.saveState}
                ariaLabel="Skill Markdown"
                onChange={props.onChangeValue}
                onSave={props.onSave}
              />
            ) : props.selectedAsset ? (
              <div className="skill-asset-notice">
                <strong>此文件无法在这里预览</strong>
                <span>
                  {props.selectedAsset.split('/').at(-1)} 已保存在 Skill 目录中，可通过“在 Finder
                  中显示”查看。
                </span>
              </div>
            ) : (
              <div className="agent-loading">选择文件以开始编辑。</div>
            )}
          </div>
        </div>
        {props.error ? (
          <div className="agent-inline-error skill-detail-error" role="alert">
            {props.error}
          </div>
        ) : null}
        {!skill.protected ? (
          <footer className="skill-detail-footer">
            <button
              className="skill-uninstall-button"
              type="button"
              data-testid="e2e/settings/skills/detail/uninstall#button"
              onClick={props.onDelete}
            >
              卸载
            </button>
          </footer>
        ) : null}
      </Dialog.Content>
    </Dialog.Root>
  )
}
