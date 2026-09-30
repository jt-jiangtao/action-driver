import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ModelCapability } from '@action-driver/model-connections'
import type { ModelOptionItemProjection } from '../../models/model-selection'
import { AppIcon } from '../ui/AppIcon'
import { e2eId } from '../../testing/e2e-id'

const capabilities: ReadonlyArray<{ key: ModelCapability; name: string }> = [
  { key: 'text', name: '文本' },
  { key: 'reasoning', name: '推理' },
  { key: 'vision', name: '视觉' },
  { key: 'image_generation', name: '生图' }
]

const stateName = { success: '成功', failed: '失败', untested: '待测试' } as const

export function ModelOptionItem({
  active,
  keyboardActive,
  model,
  optionId,
  selected,
  onSelect
}: {
  active: boolean
  keyboardActive: boolean
  model: ModelOptionItemProjection
  optionId: string
  selected: boolean
  onSelect(): void
}) {
  const descriptionId = useId()
  const iconRef = useRef<HTMLSpanElement>(null)
  const [hovered, setHovered] = useState(false)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const rows = capabilities.map(({ key, name }) => ({
    key,
    name,
    state: model.capabilityStates?.[key] ?? 'untested'
  }))
  const description = rows.map(({ name, state }) => `${name}：${stateName[state]}`).join('，')
  const updatePosition = () => {
    const rect = iconRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 188
    const height = 138
    setPosition({
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top:
        rect.bottom + 8 + height > window.innerHeight
          ? Math.max(8, rect.top - height - 8)
          : rect.bottom + 8
    })
  }
  useEffect(() => {
    if (keyboardActive) updatePosition()
  }, [keyboardActive])

  return (
    <>
      <button
        aria-describedby={descriptionId}
        aria-selected={selected}
        aria-label={model.name}
        className="model-option-item"
        data-active={active}
        data-testid={e2eId('e2e/shared/model-selector/models/:model-id#option', {
          'model-id': model.id
        })}
        onClick={onSelect}
        disabled={model.disabled}
        id={optionId}
        role="option"
        tabIndex={-1}
        type="button"
      >
        <span className="model-option-main">
          <span className="model-option-label">{model.name}</span>
          <span
            aria-label="查看能力状态"
            className="model-capability-info"
            onMouseEnter={() => {
              updatePosition()
              setHovered(true)
            }}
            onMouseLeave={() => setHovered(false)}
            ref={iconRef}
            role="img"
          >
            <AppIcon name="info" size={14} />
          </span>
        </span>
        <span className="sr-only" id={descriptionId}>
          {description}
        </span>
        {selected ? (
          <span className="model-option-check">
            <AppIcon name="check" />
          </span>
        ) : null}
      </button>
      {(hovered || keyboardActive) &&
        createPortal(
          <div className="model-capability-tooltip" role="tooltip" style={position}>
            {rows.map(({ key, name, state }) => (
              <span className="model-capability-tooltip-row" key={key}>
                <span>{name}：</span>
                <span data-state={state}>{stateName[state]}</span>
              </span>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}
