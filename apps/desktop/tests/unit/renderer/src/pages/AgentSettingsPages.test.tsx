import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MainPromptPage } from '../../../../../src/renderer/src/pages/MainPromptPage'
import { SkillsPage } from '../../../../../src/renderer/src/pages/SkillsPage'
import { MockAgentFilesService } from '../../../../../src/renderer/src/services/mock-agent-files'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'

function renderWithQuery(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}

vi.mock('../../../../../src/renderer/src/components/settings/LocalSourceEditor', () => ({
  default: ({
    value,
    onChange,
    ariaLabel
  }: {
    value: string
    onChange(value: string): void
    ariaLabel: string
  }) => (
    <textarea
      aria-label={`${ariaLabel} 源码`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}))

describe('Agent settings pages', () => {
  it('reuses the saved main prompt when reopening its page', async () => {
    const service = new MockAgentFilesService()
    const get = vi.spyOn(service, 'getMainPrompt')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const page = () => (
      <QueryClientProvider client={client}>
        <MainPromptPage service={service} onBack={() => undefined} />
      </QueryClientProvider>
    )
    const first = render(page())
    await screen.findByRole('textbox', { name: '主提示词 Markdown' })
    first.unmount()
    const second = render(page())
    await screen.findByRole('textbox', { name: '主提示词 Markdown' })
    expect(get).toHaveBeenCalledOnce()
    second.unmount()
  })

  it('reuses the Skill list when returning to the page without a mutation', async () => {
    const service = new MockAgentFilesService()
    const list = vi.spyOn(service, 'listSkills')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const page = () => (
      <QueryClientProvider client={client}>
        <SkillsPage service={service} onBack={() => undefined} />
      </QueryClientProvider>
    )
    const first = render(page())
    await screen.findByText('documents')
    await waitFor(() => expect(list).toHaveBeenCalledOnce())
    first.unmount()
    const second = render(page())
    await screen.findByText('documents')
    expect(list).toHaveBeenCalledOnce()
    second.unmount()
  })
  it('loads, edits, and saves the main prompt in one editor panel', async () => {
    const user = userEvent.setup()
    const service = new MockAgentFilesService()
    renderWithQuery(<MainPromptPage service={service} onBack={() => undefined} />)

    await screen.findByRole('textbox', { name: '主提示词 Markdown' })
    expect(screen.getByRole('heading', { name: 'ActionDriver 主提示词', level: 1 })).toBeVisible()
    expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '源码' }))
    await user.type(
      await screen.findByRole('textbox', { name: '主提示词 Markdown 源码' }),
      '\n\n## 新约束'
    )
    expect(screen.getByRole('button', { name: '保存更改' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '保存更改' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled())
    expect((await service.getMainPrompt()).content).toContain('新约束')
  })

  it('switches the same main prompt panel into source mode', async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <MainPromptPage service={new MockAgentFilesService()} onBack={() => undefined} />
    )

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
    renderWithQuery(<MainPromptPage service={service} onBack={() => undefined} />)

    await screen.findByRole('textbox', { name: '主提示词 Markdown' })
    await user.click(screen.getByRole('button', { name: '源码' }))
    await user.type(
      await screen.findByRole('textbox', { name: '主提示词 Markdown 源码' }),
      '保留草稿'
    )
    await user.click(screen.getByRole('button', { name: '保存更改' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('文件已在外部更改')
    expect(screen.getByRole('button', { name: '重试保存' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeEnabled()
  })

  it('restores the built-in main prompt only after confirmation', async () => {
    const user = userEvent.setup()
    const service = new MockAgentFilesService()
    renderWithQuery(<MainPromptPage service={service} onBack={() => undefined} />)

    await screen.findByRole('textbox', { name: '主提示词 Markdown' })
    await user.click(screen.getByRole('button', { name: '源码' }))
    const source = await screen.findByRole('textbox', { name: '主提示词 Markdown 源码' })
    await user.clear(source)
    await user.type(source, '# 临时提示词')
    await user.click(screen.getByRole('button', { name: '恢复默认' }))

    expect(screen.getByRole('dialog', { name: '恢复默认主提示词？' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '恢复默认主提示词？' })).not.toBeInTheDocument()
    expect(source).toHaveValue('# 临时提示词')

    await user.click(screen.getByRole('button', { name: '恢复默认' }))
    await user.click(screen.getByRole('button', { name: '确认恢复' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled())
    expect((await service.getMainPrompt()).content).toContain('# ActionDriver 主提示词')
  })

  it('offers save, discard, and cancel before leaving a dirty main prompt', async () => {
    const user = userEvent.setup()
    const openConnections = vi.fn()
    renderWithQuery(
      <MainPromptPage
        service={new MockAgentFilesService()}
        onBack={() => undefined}
        onOpenConnections={openConnections}
      />
    )

    await screen.findByRole('textbox', { name: '主提示词 Markdown' })
    await user.click(screen.getByRole('button', { name: '源码' }))
    await user.type(await screen.findByRole('textbox', { name: '主提示词 Markdown 源码' }), '草稿')
    await user.click(screen.getByRole('button', { name: '模型连接' }))

    const dialog = screen.getByRole('dialog', { name: '离开主提示词？' })
    expect(dialog).toBeVisible()
    expect(screen.getByRole('button', { name: '保存并离开' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '放弃更改' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(openConnections).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '模型连接' }))
    await user.click(screen.getByRole('button', { name: '放弃更改' }))
    expect(openConnections).toHaveBeenCalledOnce()
  })

  it('saves a dirty main prompt before completing deferred navigation', async () => {
    const user = userEvent.setup()
    const service = new MockAgentFilesService()
    const openConnections = vi.fn()
    renderWithQuery(
      <MainPromptPage
        service={service}
        onBack={() => undefined}
        onOpenConnections={openConnections}
      />
    )

    await screen.findByRole('textbox', { name: '主提示词 Markdown' })
    await user.click(screen.getByRole('button', { name: '源码' }))
    await user.type(
      await screen.findByRole('textbox', { name: '主提示词 Markdown 源码' }),
      '\n保存后离开'
    )
    await user.click(screen.getByRole('button', { name: '模型连接' }))
    await user.click(screen.getByRole('button', { name: '保存并离开' }))

    await waitFor(() => expect(openConnections).toHaveBeenCalledOnce())
    expect((await service.getMainPrompt()).content).toContain('保存后离开')
  })

  it('opens a skill into its file tree and saves the selected file', async () => {
    const user = userEvent.setup()
    const service = new MockAgentFilesService()
    await service.createSkill({ name: 'note-writer', description: 'Write notes.' })
    renderWithQuery(<SkillsPage service={service} onBack={() => undefined} />)

    expect(await screen.findByRole('heading', { name: 'Skills' })).toBeVisible()
    expect(await screen.findByText('documents')).toBeVisible()
    expect(screen.queryByText('不可用')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /note-writer/ }))
    expect(await screen.findByRole('tree', { name: 'Skill 文件' })).toBeVisible()
    expect(screen.getByRole('treeitem', { name: 'SKILL.md' })).toBeVisible()
    await screen.findByRole('textbox', { name: 'Skill Markdown' })
    await user.click(screen.getByRole('treeitem', { name: 'README.md' }))
    expect(
      await screen.findByRole('heading', { name: 'References', level: 1 })
    ).toBeVisible()
    await user.click(screen.getByRole('treeitem', { name: 'SKILL.md' }))
    expect(
      await within(screen.getByTestId('e2e/settings/agent-editors/skill/content#input')).findByRole(
        'heading',
        { name: 'note-writer', level: 1 }
      )
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: '源码' }))
    await user.type(
      await screen.findByRole('textbox', { name: 'Skill Markdown 源码' }),
      '\n\n## 安全边界'
    )
    await user.click(screen.getByRole('button', { name: '保存更改' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled())
    expect(
      (await service.readFile('.action-driver/skills/note-writer/SKILL.md')).content
    ).toContain('安全边界')
  })

  it('returns from a skill detail to the repository list', async () => {
    const user = userEvent.setup()
    renderWithQuery(<SkillsPage service={new MockAgentFilesService()} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: /presentations/ }))
    await user.click(await screen.findByRole('button', { name: '关闭 Skill 详情' }))
    expect(screen.getByRole('heading', { name: 'Skills' })).toBeVisible()
    expect(screen.getByText('data-inspector')).toBeVisible()
  })

  it('shows system Skills in the Codex-style list and opens a read-only detail dialog', async () => {
    const user = userEvent.setup()
    renderWithQuery(<SkillsPage service={new MockAgentFilesService()} onBack={() => undefined} />)
    expect(await screen.findByRole('button', { name: /documents/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Skill Creator/ })).toBeVisible()
    expect(screen.getAllByText('系统').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /documents/ }))
    const detail = screen.getByRole('dialog', { name: 'documents' })
    expect(detail).toBeVisible()
    expect(within(detail).getByText('系统 Skill')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Skills' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存更改' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '卸载' })).not.toBeInTheDocument()
    expect(document.activeElement).toHaveAttribute('aria-label', '关闭 Skill 详情')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'documents' })).not.toBeInTheDocument()
  })

  it('shows uninstall for a personal Skill in the detail footer', async () => {
    const user = userEvent.setup()
    renderWithQuery(<SkillsPage service={new MockAgentFilesService()} onBack={() => undefined} />)
    await user.click(await screen.findByRole('button', { name: /data-inspector/ }))
    const detail = screen.getByRole('dialog', { name: 'data-inspector' })
    expect(within(detail).getByText('个人 Skill')).toBeVisible()
    await user.click(within(detail).getByRole('button', { name: '卸载' }))
    expect(screen.getByRole('dialog', { name: '删除 Skill' })).toBeVisible()
  })

  it('lists skill-creator assets without trying to render image bytes as Markdown', async () => {
    const user = userEvent.setup()
    renderWithQuery(<SkillsPage service={new MockAgentFilesService()} onBack={() => undefined} />)
    await user.click(await screen.findByRole('button', { name: /Skill Creator/ }))
    await user.click(screen.getByRole('treeitem', { name: 'skill-creator.png' }))
    expect(screen.getByText('此文件无法在这里预览')).toBeVisible()
    expect(screen.getByRole('treeitem', { name: 'skill-creator.png' }))
      .toHaveAttribute('aria-selected', 'true')
  })

  it('toggles a system Skill and copies its Markdown from the detail menu', async () => {
    const user = userEvent.setup()
    const service = new MockAgentFilesService()
    renderWithQuery(<SkillsPage service={service} onBack={() => undefined} />)
    await user.click(await screen.findByRole('button', { name: /Skill Creator/ }))
    const detail = screen.getByRole('dialog', { name: 'Skill Creator' })
    await user.click(within(detail).getByRole('switch', { name: '停用 Skill Creator' }))
    expect(await within(detail).findByRole('switch', { name: '启用 Skill Creator' }))
      .toHaveAttribute('aria-checked', 'false')
    expect((await service.listSkills()).find((skill) => skill.id === 'skill-creator')?.enabled)
      .toBe(false)

    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    await user.click(screen.getByRole('button', { name: 'Skill 操作' }))
    await user.click(screen.getByRole('menuitem', { name: '复制 Markdown' }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('# Skill Creator'))
  })

  it('adds Skills from GitHub and a selected local folder', async () => {
    const user = userEvent.setup()
    const service = new MockAgentFilesService()
    vi.spyOn(service, 'chooseLocalSkillFolder').mockResolvedValue('/tmp/local-helper')
    renderWithQuery(<SkillsPage service={service} onBack={() => undefined} />)
    await user.click(await screen.findByRole('button', { name: '添加' }))
    await user.click(screen.getByRole('menuitem', { name: '从 GitHub 安装' }))
    await user.type(screen.getByRole('textbox', { name: 'GitHub URL' }), 'https://github.com/acme/tools/tree/main/github-helper')
    await user.click(screen.getByRole('button', { name: '安装 Skill' }))
    expect(await screen.findByText('github-helper')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '添加' }))
    await user.click(screen.getByRole('menuitem', { name: '从本地文件夹安装' }))
    expect(await screen.findByText('local-helper')).toBeVisible()
  })

  it('keeps the Skill list visible when a local installation fails', async () => {
    const user = userEvent.setup()
    const service = new MockAgentFilesService()
    vi.spyOn(service, 'chooseLocalSkillFolder').mockResolvedValue('/tmp/broken-skill')
    vi.spyOn(service, 'installSkill').mockRejectedValue(new Error('Skill 文件夹缺少 SKILL.md'))
    renderWithQuery(<SkillsPage service={service} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: '添加' }))
    await user.click(screen.getByRole('menuitem', { name: '从本地文件夹安装' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('缺少 SKILL.md')
    expect(screen.getByRole('button', { name: /documents/ })).toBeVisible()
  })

  it('keeps an instruction Skill available after saving SKILL.md without an executor', async () => {
    const user = userEvent.setup()
    const service = new MockAgentFilesService()
    renderWithQuery(<SkillsPage service={service} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: /data-inspector/ }))
    await user.click(await screen.findByRole('button', { name: '源码' }))
    const source = await screen.findByRole('textbox', { name: 'Skill Markdown 源码' })
    await user.clear(source)
    await user.type(source, '# Data Inspector\n\nInspect local files.\n')
    await user.click(screen.getByRole('button', { name: '保存更改' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled())
    await user.click(await screen.findByRole('button', { name: '关闭 Skill 详情' }))

    expect(await screen.findByRole('switch', { name: '启用 data-inspector' })).toBeEnabled()
    expect((await service.listSkills()).find((skill) => skill.id === 'data-inspector'))
      .toMatchObject({ available: true, executorId: null })
  })

  it('creates a skill through the validated dialog and exposes protected actions safely', async () => {
    const user = userEvent.setup()
    renderWithQuery(<SkillsPage service={new MockAgentFilesService()} onBack={() => undefined} />)

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

    await user.click(screen.getByRole('button', { name: /documents/ }))
    await user.click(await screen.findByRole('button', { name: 'Skill 操作' }))
    expect(screen.getByRole('menuitem', { name: '重命名' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: '删除 Skill' })).toBeDisabled()
  })

  it('shows an exclusive retry state when the skill repository fails to load', async () => {
    const service = new MockAgentFilesService()
    vi.spyOn(service, 'listSkills').mockRejectedValueOnce(new Error('无法读取 Skills'))
    renderWithQuery(<SkillsPage service={service} onBack={() => undefined} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取 Skills')
    expect(screen.queryByText('没有匹配的 Skill')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled()
  })

  it('reports a rejected skill file path without replacing the file tree', async () => {
    const user = userEvent.setup()
    const service = new MockAgentFilesService()
    vi.spyOn(service, 'readFile').mockRejectedValueOnce(new Error('文件路径不在允许的目录内'))
    renderWithQuery(<SkillsPage service={service} onBack={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: /documents/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('文件路径不在允许的目录内')
    expect(screen.getByRole('tree', { name: 'Skill 文件' })).toBeVisible()
  })
})
