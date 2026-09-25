import type { ModelCapability, ModelCapabilityResultDto } from '@actiondriver/model-connections'
import { AppIcon } from '../ui/AppIcon'

const names: Record<ModelCapability, string> = {
  text: '文本',
  reasoning: '推理',
  vision: '视觉',
  image_generation: '生图'
}

export function ModelCapabilityResults({
  capabilities,
  probeCandidates,
  catalogLabels,
  testing = false,
  requestFailed = false
}: {
  capabilities?: Partial<Record<ModelCapability, ModelCapabilityResultDto>> | undefined
  probeCandidates?: readonly ModelCapability[] | undefined
  catalogLabels?: readonly string[] | undefined
  testing?: boolean | undefined
  requestFailed?: boolean | undefined
}) {
  const entries =
    probeCandidates ??
    (Object.keys(names) as ModelCapability[]).filter((key) => capabilities?.[key])
  if (entries.length === 0 && catalogLabels?.length) return null
  return (
    <span className="model-capability-results">
      {entries.length === 0 ? (
        <span className={requestFailed ? 'model-capability is-failed' : ''}>
          {requestFailed ? '失败' : testing ? '测试中' : '待测试'}
        </span>
      ) : null}
      {entries.map((key) => {
        const state = testing
          ? 'testing'
          : requestFailed
            ? 'failed'
            : (capabilities?.[key]?.state ?? 'untested')
        const label =
          state === 'testing'
            ? '测试中'
            : state === 'untested'
              ? '待测试'
              : state === 'success'
                ? '成功'
                : '失败'
        return (
          <span
            className={`model-capability is-${state}`}
            key={key}
            role={state === 'testing' ? 'status' : undefined}
          >
            {state === 'testing' ? <AppIcon className="spin-icon" name="loader" /> : null}
            {names[key]} · {label}
          </span>
        )
      })}
    </span>
  )
}
