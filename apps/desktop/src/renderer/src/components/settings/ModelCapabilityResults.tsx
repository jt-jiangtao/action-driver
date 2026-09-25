import type { ModelCapability, ModelCapabilityResultDto } from '@actiondriver/model-connections'

const names: Record<ModelCapability, string> = {
  text: '文本',
  reasoning: '推理',
  vision: '视觉',
  image_generation: '生图'
}

const states: Record<ModelCapabilityResultDto['state'], string> = {
  untested: '待测试',
  testing: '测试中',
  success: '通过',
  unsupported: '不支持',
  failed: '失败',
  inconclusive: '无法判定'
}

const displayLabels: Record<string, string> = {
  speech_recognition: '语音识别 · 未接入测试',
  realtime_chat: '实时语音 · 未接入测试',
  speech_synthesis: '语音合成 · 未接入测试',
  text_to_video: '文生视频 · 未接入测试',
  image_to_video: '图生视频 · 未接入测试',
  reference_to_video: '参考生视频 · 未接入测试'
}

export function ModelCapabilityResults({
  capabilities,
  catalogLabels
}: {
  capabilities?: Partial<Record<ModelCapability, ModelCapabilityResultDto>> | undefined
  catalogLabels?: readonly string[] | undefined
}) {
  const entries = (Object.keys(names) as ModelCapability[]).filter((key) => capabilities?.[key])
  return (
    <span className="model-capability-results">
      {entries.length === 0 && !catalogLabels?.length ? <span>待测试</span> : null}
      {entries.map((key) => {
        const result = capabilities![key]!
        const isLegacy = result.source === 'legacy' && result.state === 'untested'
        const title =
          result.failure?.message ??
          (isLegacy
            ? '旧测试结果需要重新验证'
            : result.testedAt
              ? `实测于 ${result.testedAt}`
              : undefined)
        return (
          <span className={`model-capability is-${result.state}`} key={key} title={title}>
            {names[key]} · {isLegacy ? '需重新测试' : states[result.state]}
          </span>
        )
      })}
      {catalogLabels?.map((label) => (
        <span className="model-capability is-display-only" key={label}>
          {displayLabels[label] ?? label}
        </span>
      ))}
    </span>
  )
}
