import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MainPromptPage } from './MainPromptPage'
import { SkillsPage } from './SkillsPage'
import { MockAgentFilesService } from '../services/mock-agent-files'

vi.mock('@monaco-editor/react', () => ({
  default: ({
    value,
    onChange,
    options
  }: {
    value: string
    onChange(value: string): void
    options: { ariaLabel: string }
  }) => (
    <textarea
      aria-label={options.ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}))

describe('Agent settings pages', () => {
  it('loads, edits, and saves the main prompt in one editor panel', async () => {
    const user = userEvent.setup()
    const service = new MockAgentFilesService()
    render(<MainPromptPage service={service} onBack={() => undefined} />)

    await screen.findByRole('textbox', { name: '主提示词 Markdown' })
    expect(screen.getByRole('heading', { name: 'ActionDriver 主提示词', level: 1 })).toBeVisible()
    expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '源码' }))
    await user.type(
      screen.getByRole('textbox', { name: '主提示词 Markdown 源码' }),
      '\n\n## 新约束'
    )
    expect(screen.getByRole('button', { name: '保存更改' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '保存更改' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled())
    expect((await service.getMainPrompt()).content).toContain('新约束')
  })

  it('switches the same main prompt panel into source mode', async () => {
    const user = userEvent.setup()
    render(<MainPromptPage service={new MockAgentFilesService()} onBack={() => undefined} />)

    await screen.findByRole('textbox', { name: '主提示词 Markdown' })
    await user.click(screen.getByRole('button', { name: '源码' }))

    expect(
      screen.getByTestId('e2e/settings/agent-editors/main-prompt/source#section')
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '源码' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps a dirty main prompt draft and offers reload after a save conflict', async () => {
    const user = userEvent.setup()
    const service = new MockAgentFilesService()
    vi.spyOn(service, 'saveFile').mockRejectedValueOnce(new Error('文件已在外部更改'))
    render(<MainPromptPage service={service} onBack={() => undefined} />)

    await screen.findByRole('textbox', { name: '主提示词 Markdown' })
    await user.click(screen.getByRole('button', { name: '源码' }))
    await user.type(screen.getByRole('textbox', { name: '主提示词 Markdown 源码' }), '保留草稿')
    await user.click(screen.getByRole('button', { name: '保存更改' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('文件已在外部更改')
    expect(screen.getByRole('button', { name: '重试保存' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeEnabled()
  })

  it('opens a skill into its file tree and saves the selected file', async () => {
    const user = userEvent.setup()
    const service = new MockAgentFilesService()
    render(<SkillsPage service={service} onBack={() => undefined} />)

    expect(await screen.findByRole('heading', { name: 'Skills' })).toBeVisible()
    expect(screen.getByText('browser-tools')).toBeVisible()
    expect(screen.getByText('不可用')).toBeVisible()

    await user.click(screen.getByRole('button', { name: /browser-tools/ }))
    expect(await screen.findByRole('tree', { name: 'Skill 文件' })).toBeVisible()
    expect(screen.getByRole('treeitem', { name: 'SKILL.md' })).toBeVisible()
    await screen.findByRole('textbox', { name: 'Skill Markdown' })
    await user.click(screen.getByRole('treeitem', { name: 'README.md' }))
    expect(
      await screen.findByRole('heading', { name: 'browser-tools references', level: 1 })
    ).toBeVisible()
    await user.click(screen.getByRole('treeitem', { name: 'SKILL.md' }))
    expect(
      await within(screen.getByTestId('e2e/settings/agent-editors/skill/content#input')).findByRole(
        'heading',
        { name: 'browser-tools', level: 1 }
      )
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: '源码' }))
    await user.type(screen.getByRole('textbox', { name: 'Skill Markdown 源码' }), '\n\n## 安全边界')
    await user.click(screen.getByRole('button', { name: '保存更改' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled())
    expect(
      (await service.readFile('.action-driver/skills/browser-tools/SKILL.md')).content
    ).toContain('安全边界')
  })

  it('returns from a skill detail to the repository list', async () => {
    const user = userEvent.setup()
    render(<SkillsPage service={new MockAgentFilesService()} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: /report-writer/ }))
    await user.click(await screen.findByRole('button', { name: '返回 Skills' }))
    expect(screen.getByRole('heading', { name: 'Skills' })).toBeVisible()
    expect(screen.getByText('data-inspector')).toBeVisible()
  })

  it('creates a skill through the validated dialog and exposes protected actions safely', async () => {
    const user = userEvent.setup()
    render(<SkillsPage service={new MockAgentFilesService()} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: '新建 Skill' }))
    const dialog = screen.getByRole('dialog', { name: '新建 Skill' })
    expect(dialog).toBeVisible()
    expect(screen.getByRole('button', { name: '创建 Skill' })).toBeDisabled()
    await user.type(screen.getByLabelText('Skill 名称'), 'Invalid Name')
    expect(screen.getByText('仅支持小写英文、数字和单个连字符')).toBeVisible()
    expect(screen.getByRole('button', { name: '创建 Skill' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Skill 名称'))
    await user.type(screen.getByLabelText('Skill 名称'), 'release-helper')
    await user.type(screen.getByLabelText('Skill 描述'), '整理发布记录')
    await user.click(screen.getByRole('button', { name: '创建 Skill' }))
    expect(await screen.findByText('release-helper')).toBeVisible()

    await user.click(screen.getByRole('button', { name: /browser-tools/ }))
    await user.click(await screen.findByRole('button', { name: 'Skill 操作' }))
    expect(screen.getByRole('menuitem', { name: '重命名' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: '删除 Skill' })).toBeDisabled()
  })

  it('shows an exclusive retry state when the skill repository fails to load', async () => {
    const service = new MockAgentFilesService()
    vi.spyOn(service, 'listSkills').mockRejectedValueOnce(new Error('无法读取 Skills'))
    render(<SkillsPage service={service} onBack={() => undefined} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取 Skills')
    expect(screen.queryByText('没有匹配的 Skill')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled()
  })

  it('reports a rejected skill file path without replacing the file tree', async () => {
    const user = userEvent.setup()
    const service = new MockAgentFilesService()
    vi.spyOn(service, 'readFile').mockRejectedValueOnce(new Error('文件路径不在允许的目录内'))
    render(<SkillsPage service={service} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: /browser-tools/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('文件路径不在允许的目录内')
    expect(screen.getByRole('tree', { name: 'Skill 文件' })).toBeVisible()
  })
})
