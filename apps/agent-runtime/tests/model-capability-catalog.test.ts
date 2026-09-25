import { describe, expect, it } from 'vitest'
import { capabilityCandidates } from '../src/model-connections/model-capability-catalog'

const tokenPlanUrl = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'

describe('capabilityCandidates', () => {
  it('chooses text, reasoning and vision probes for a listed visual model', () => {
    expect(capabilityCandidates('qwen3.8-max', tokenPlanUrl)).toEqual({
      probes: ['text', 'reasoning', 'vision'],
      displayOnly: []
    })
  })

  it('tests vision for the listed text-only qwen model instead of trusting its name', () => {
    expect(capabilityCandidates('qwen3.7-max', tokenPlanUrl)).toEqual({
      probes: ['text', 'reasoning', 'vision'],
      displayOnly: []
    })
  })

  it('tests all three chat capabilities as well as image generation for Wan', () => {
    expect(capabilityCandidates('wan2.7-image', tokenPlanUrl)).toEqual({
      probes: ['text', 'reasoning', 'vision', 'image_generation'],
      displayOnly: []
    })
  })

  it('probes all three chat capabilities for a video model without testing video generation', () => {
    expect(capabilityCandidates('happyhorse-1.1-t2v', tokenPlanUrl)).toEqual({
      probes: ['text', 'reasoning', 'vision'],
      displayOnly: ['text_to_video']
    })
  })

  it('probes all three chat capabilities for an audio model without testing audio', () => {
    expect(capabilityCandidates('qwen-audio-3.0-asr-flash', tokenPlanUrl)).toEqual({
      probes: ['text', 'reasoning', 'vision'],
      displayOnly: ['speech_recognition']
    })
  })

  it('probes generic compatible models without treating a name as proof', () => {
    expect(capabilityCandidates('custom-model', 'https://example.com/v1')).toEqual({
      probes: ['text', 'reasoning', 'vision', 'image_generation'],
      displayOnly: []
    })
  })

  it('does not apply Token Plan catalog outside the official gateway', () => {
    expect(capabilityCandidates('qwen3.7-max', 'https://example.com/v1')).toEqual({
      probes: ['text', 'reasoning', 'vision', 'image_generation'],
      displayOnly: []
    })
  })
})
