import * as Dialog from '@radix-ui/react-dialog'
import { AppIcon } from '../../components/ui/AppIcon'

export type SkillActionKind = 'create' | 'rename' | 'delete' | 'install-github'

const DIALOG_TITLES: Record<SkillActionKind, string> = {
  create: '新建 Skill',
  rename: '重命名 Skill',
  delete: '删除 Skill',
  'install-github': '从 GitHub 安装 Skill'
}

export type SkillActionDialogProps = {
  kind: SkillActionKind
  name: string
  description: string
  installUrl: string
  busy: boolean
  error: string | null
  nameError: string | null
  targetName: string
  onSubmit(): void
  onClose(): void
  onNameChange(value: string): void
  onDescriptionChange(value: string): void
  onInstallUrlChange(value: string): void
}

/**
 * Create/rename/delete/install dialog. Radix owns Escape, outside interaction and focus
 * containment; a busy submission refuses to close until the service answers.
 */
export function SkillActionDialog(props: SkillActionDialogProps) {
  const submitDisabled =
    props.busy ||
    (props.kind === 'install-github'
      ? !props.installUrl.trim().startsWith('https://github.com/')
      : props.kind !== 'delete' && (!props.name.trim().toLowerCase() || Boolean(props.nameError)))

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <Dialog.Overlay className="agent-dialog-backdrop" />
      <Dialog.Content
        className={`agent-dialog ${props.kind === 'delete' ? 'is-confirm' : ''}`}
        onEscapeKeyDown={(event) => {
          if (props.busy) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (props.busy) event.preventDefault()
        }}
      >
        <header>
          <div>
            <Dialog.Title asChild>
              <h2>{DIALOG_TITLES[props.kind]}</h2>
            </Dialog.Title>
            <Dialog.Description asChild>
              <p>
                {props.kind === 'create'
                  ? '将在 .action-driver/skills 中创建对应目录。'
                  : props.kind === 'install-github'
                    ? '粘贴仓库地址或仓库中的 Skill 子目录地址。'
                    : props.kind === 'rename'
                      ? '修改 Skill 在列表中显示的名称。'
                      : `确定删除 ${props.targetName}？此操作不可撤销。`}
              </p>
            </Dialog.Description>
          </div>
          <button
            className="plain-icon-action"
            data-testid="e2e/settings/skills/dialog/close#button"
            type="button"
            aria-label="关闭"
            onClick={props.onClose}
          >
            <AppIcon name="close" />
          </button>
        </header>
        {props.kind === 'install-github' ? (
          <div className="agent-dialog-fields">
            <label>
              <span>GitHub URL</span>
              <input
                type="url"
                aria-label="GitHub URL"
                data-testid="e2e/settings/skills/dialog/github-url#input"
                value={props.installUrl}
                placeholder="https://github.com/owner/repo/tree/main/skills/example"
                onChange={(event) => props.onInstallUrlChange(event.target.value)}
              />
            </label>
          </div>
        ) : props.kind !== 'delete' ? (
          <div className="agent-dialog-fields">
            <label>
              <span>Skill 名称</span>
              <input
                data-testid="e2e/settings/skills/dialog/name#input"
                name="skill-name"
                autoComplete="off"
                aria-label="Skill 名称"
                aria-invalid={Boolean(props.nameError)}
                value={props.name}
                onChange={(event) => props.onNameChange(event.target.value)}
                placeholder="example-skill"
              />
              {props.nameError ? (
                <small className="agent-field-error">{props.nameError}</small>
              ) : null}
            </label>
            {props.kind === 'create' ? (
              <label>
                <span>Skill 描述</span>
                <textarea
                  data-testid="e2e/settings/skills/dialog/description#textarea"
                  name="skill-description"
                  aria-label="Skill 描述"
                  value={props.description}
                  onChange={(event) => props.onDescriptionChange(event.target.value)}
                  placeholder="说明这个 Skill 在什么情况下使用"
                />
              </label>
            ) : null}
          </div>
        ) : null}
        {props.error ? (
          <p className="agent-dialog-error" role="alert">
            {props.error}
          </p>
        ) : null}
        <footer>
          <button
            className="agent-secondary-button"
            data-testid="e2e/settings/skills/dialog/cancel#button"
            type="button"
            onClick={props.onClose}
            disabled={props.busy}
          >
            取消
          </button>
          <button
            className={props.kind === 'delete' ? 'agent-danger-button' : 'agent-primary-button'}
            data-testid="e2e/settings/skills/dialog/submit#button"
            type="button"
            onClick={props.onSubmit}
            disabled={submitDisabled}
          >
            {props.busy
              ? '处理中…'
              : props.kind === 'create'
                ? '创建 Skill'
                : props.kind === 'install-github'
                  ? '安装 Skill'
                  : props.kind === 'rename'
                    ? '保存名称'
                    : '确认删除'}
          </button>
        </footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}
