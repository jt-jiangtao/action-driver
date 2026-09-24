import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { ModelRef } from '@actiondriver/contracts'
import type { ModelSelectionProjection } from '../../models/model-selection'
import { findSelectedModel } from '../../models/model-selection'
import { ModelConnectionItem } from './ModelConnectionItem'
import { ModelOptionItem } from './ModelOptionItem'
import { ModelSelectorTrigger } from './ModelSelectorTrigger'

export function ModelSelector({
  projection,
  onSelect,
  onOpenChange,
  closeKey
}: {
  projection: ModelSelectionProjection
  onSelect(model: ModelRef): void
  onOpenChange?(open: boolean): void
  closeKey?: string
}) {
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const listboxRef = useRef<HTMLDivElement>(null)
  const selected = findSelectedModel(projection)
  const selectedConnectionId = selected?.connection.id ?? projection.connections[0]?.id
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(selectedConnectionId ? [selectedConnectionId] : [])
  )
  useEffect(() => {
    if (!selectedConnectionId) return
    setExpanded((current) =>
      current.has(selectedConnectionId)
        ? current
        : new Set([...current, selectedConnectionId])
    )
  }, [selectedConnectionId])
  const visibleModels = useMemo(
    () => projection.connections.flatMap((connection) => expanded.has(connection.id) ? connection.models.map((model) => ({ connection, model })) : []),
    [expanded, projection.connections]
  )
  const initialIndex = Math.max(0, visibleModels.findIndex(({ model }) =>
    model.ref.connectionId === projection.selected?.connectionId &&
    model.ref.modelId === projection.selected?.modelId
  ))
  const [activeIndex, setActiveIndex] = useState(initialIndex)

  const setMenuOpen = (nextOpen: boolean) => {
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  useEffect(() => {
    setOpen(false)
  }, [closeKey])

  useEffect(() => {
    if (!open) return
    listboxRef.current?.focus()
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    return () => document.removeEventListener('pointerdown', closeOnOutside)
  }, [open])

  const selectActive = () => {
    const entry = visibleModels[activeIndex]
    if (!entry || entry.model.disabled) return
    onSelect(entry.model.ref)
    setMenuOpen(false)
  }

  const handleMenuKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setMenuOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      if (visibleModels.length === 0) return
      let next = activeIndex
      do next = (next + direction + visibleModels.length) % visibleModels.length
      while (visibleModels[next]?.model.disabled && next !== activeIndex)
      setActiveIndex(next)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      selectActive()
    }
  }

  return (
    <div className="model-selector" ref={rootRef}>
      <ModelSelectorTrigger
        connectionName={selected?.connection.name ?? modelSelectionLabel(projection)}
        controls={menuId}
        modelName={selected?.model.name ?? ''}
        disabled={projection.state === 'loading' || projection.state === 'empty'}
        onClick={() => setMenuOpen(!open)}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            setActiveIndex(initialIndex)
            setMenuOpen(true)
          }
        }}
        open={open}
      />
      {open ? (
        <div
          aria-label="选择模型"
          className="model-selector-menu"
          id={menuId}
          onKeyDown={handleMenuKeyDown}
          ref={listboxRef}
          role="listbox"
          tabIndex={-1}
        >
          {projection.connections.map((connection) => {
            const isExpanded = expanded.has(connection.id)
            return (
              <div className="model-selector-group" key={connection.id}>
                <ModelConnectionItem
                  connectionId={connection.id}
                  expanded={isExpanded}
                  name={connection.name}
                  onToggle={() => {
                    setExpanded((current) => {
                      const next = new Set(current)
                      if (next.has(connection.id)) next.delete(connection.id)
                      else next.add(connection.id)
                      return next
                    })
                  }}
                />
                {isExpanded ? connection.models.map((model) => {
                  const modelIndex = visibleModels.findIndex(({ model: candidate }) =>
                    candidate.ref.connectionId === model.ref.connectionId &&
                    candidate.ref.modelId === model.ref.modelId
                  )
                  return (
                    <ModelOptionItem
                      active={modelIndex === activeIndex}
                      key={`${connection.id}:${model.id}`}
                      model={model}
                      onSelect={() => {
                        if (model.disabled) return
                        onSelect(model.ref)
                        setMenuOpen(false)
                      }}
                      selected={
                        model.ref.connectionId === projection.selected?.connectionId &&
                        model.ref.modelId === projection.selected?.modelId
                      }
                    />
                  )
                }) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function modelSelectionLabel(projection: ModelSelectionProjection): string {
  if (projection.state === 'loading') return '正在加载模型'
  if (projection.state === 'error') return '模型加载失败'
  if (projection.state === 'empty') return '暂无可用模型'
  return '选择模型'
}
