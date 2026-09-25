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
  speech_recognition: '语音识别 · 未测试',
  realtime_chat: '实时语音 · 未测试',
  speech_synthesis: '语音合成 · 未测试',
  text_to_video: '文生视频 · 未测试',
  image_to_video: '图生视频 · 未测试',
  reference_to_video: '参考生视频 · 未测试'
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
        return (
          <span className={`model-capability is-${result.state}`} key={key} title={result.failure?.message ?? (result.testedAt ? `测试于 ${result.testedAt}` : undefined)}>
            {names[key]} · {states[result.state]}
          </span>
        )
      })}
      {catalogLabels?.map((label) => (
        <span className="model-capability is-display-only" key={label}>{displayLabels[label] ?? label}</span>
      ))}
    </span>
  )
}
