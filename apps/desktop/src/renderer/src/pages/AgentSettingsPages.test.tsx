import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MainPromptPage } from './MainPromptPage'
import { SkillsPage } from './SkillsPage'
import { MockAgentFilesService } from '../services/mock-agent-files'

describe('Agent settings pages', () => {
  it('loads, edits, and saves the main prompt in one editor panel', async () => {
    const user = userEvent.setup()
    const service = new MockAgentFilesService()
    render(<MainPromptPage service={service} onBack={() => undefined} />)

    const editor = await screen.findByRole('textbox', { name: '主提示词 Markdown' })
    expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled()
    await user.type(editor, '\n\n## 新约束')
    expect(screen.getByRole('button', { name: '保存更改' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '保存更改' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled())
    expect((await service.getMainPrompt()).content).toContain('新约束')
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
    const editor = await screen.findByRole('textbox', { name: 'Skill Markdown' })
    await user.type(editor, '\n\n## 安全边界')
    await user.click(screen.getByRole('button', { name: '保存更改' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled())
    expect((await service.readFile('.action-driver/skills/browser-tools/SKILL.md')).content).toContain(
      '安全边界'
    )
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
    await user.type(screen.getByLabelText('Skill 名称'), 'release-helper')
    await user.type(screen.getByLabelText('Skill 描述'), '整理发布记录')
    await user.click(screen.getByRole('button', { name: '创建 Skill' }))
    expect(await screen.findByText('release-helper')).toBeVisible()

    await user.click(screen.getByRole('button', { name: /browser-tools/ }))
    await user.click(await screen.findByRole('button', { name: 'Skill 操作' }))
    expect(screen.getByRole('menuitem', { name: '重命名' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: '删除 Skill' })).toBeDisabled()
  })
})
