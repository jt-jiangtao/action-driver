import { AppIcon, type AppIconName } from './AppIcon'

export type ModelTestState = 'untested' | 'testing' | 'success' | 'failed'

const statusPresentation: Record<ModelTestState, { icon?: AppIconName; label: string }> = {
  untested: { label: '未测试' },
  testing: { icon: 'loader', label: '测试中' },
  success: { icon: 'check', label: '成功' },
  failed: { icon: 'circle-alert', label: '失败' }
}

export function ModelTestStatus({ state }: { state: ModelTestState }) {
  const presentation = statusPresentation[state]
  return (
    <span className="model-test-status" data-state={state}>
      {presentation.icon ? (
        <AppIcon
          name={presentation.icon}
          {...(state === 'testing' ? { className: 'ui-spin' } : {})}
        />
      ) : null}
      {presentation.label}
    </span>
  )
}
