import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppIcon } from '../../../../../../src/renderer/src/components/ui/AppIcon'
import { Checkbox } from '../../../../../../src/renderer/src/components/ui/Checkbox'
import { IconButton } from '../../../../../../src/renderer/src/components/ui/IconButton'
import { ModelTestStatus } from '../../../../../../src/renderer/src/components/ui/ModelTestStatus'
import { RadioOption } from '../../../../../../src/renderer/src/components/ui/RadioOption'
import { TextButton } from '../../../../../../src/renderer/src/components/ui/TextButton'
import { TextField } from '../../../../../../src/renderer/src/components/ui/TextField'
import { ModelStatusPill } from '../../../../../../src/renderer/src/components/ModelStatusPill'

describe('shared Figma controls', () => {
  it('forwards a required route test id through shared interactive controls', () => {
    render(
      <IconButton
        testId="e2e/shared/sidebar/search#button"
        icon="search"
        aria-label="搜索"
      />
    )

    expect(screen.getByTestId('e2e/shared/sidebar/search#button')).toHaveAccessibleName('搜索')
  })

  it('lets a plus icon inherit the primary button foreground', () => {
    render(
      <TextButton testId="e2e/settings/model-connections/add#button" variant="primary" icon="plus">
        添加模型集
      </TextButton>
    )

    expect(screen.getByRole('button', { name: '添加模型集' })).toHaveClass(
      'text-button-primary'
    )
    expect(screen.getByRole('button', { name: '添加模型集' }).querySelector('svg')).toHaveAttribute(
      'data-color',
      'currentColor'
    )
  })

  it('maps every semantic glyph through the shared icon adapter', () => {
    const { container } = render(<AppIcon name="network" />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it.each(['default', 'focused', 'filled', 'error', 'success', 'loading', 'disabled'] as const)(
    'renders text field state %s',
    (state) => {
      render(
        <TextField
          label="名称"
          testId="e2e/settings/add-model-set/name#input"
          state={state}
          value=""
          onChange={() => undefined}
        />
      )
      expect(screen.getByLabelText('名称')).toHaveAttribute('data-state', state)
    }
  )

  it('reports indeterminate checkbox state and toggles through its public callback', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <Checkbox
        checked="indeterminate"
        testId="e2e/settings/add-model-set/select-all#checkbox"
        onCheckedChange={onCheckedChange}
      >
        选择模型
      </Checkbox>
    )

    const checkbox = screen.getByRole('checkbox', { name: '选择模型' })
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed')
    await user.click(checkbox)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('exposes selected radio option semantics', () => {
    render(
      <RadioOption
        selected
        testId="e2e/settings/add-model-set/protocol-openai#radio"
        title="OpenAI 兼容"
        description="适用于标准接口"
        onSelect={() => undefined}
      />
    )
    expect(screen.getByRole('radio', { name: /OpenAI 兼容/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('disables loading buttons and exposes progress', () => {
    render(
      <TextButton
        state="loading"
        testId="e2e/settings/add-model-set/test-connection#button"
        variant="secondary"
      >
        测试连接
      </TextButton>
    )
    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '测试连接' })).toHaveAttribute('aria-busy', 'true')
  })

  it.each([
    ['untested', '未测试'],
    ['testing', '测试中'],
    ['success', '成功'],
    ['failed', '失败']
  ] as const)('renders model test status %s', (state, label) => {
    render(<ModelTestStatus state={state} />)
    expect(screen.getByText(label)).toHaveAttribute('data-state', state)
  })

  it('uses the shared Figma status presentation in settings rows', () => {
    render(<ModelStatusPill state="success" />)
    expect(screen.getByText('成功')).toHaveClass('model-test-status')
    expect(screen.queryByText('可用')).not.toBeInTheDocument()
  })
})
