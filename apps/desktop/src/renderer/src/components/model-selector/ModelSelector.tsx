import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
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
  onSelect(modelId: string): void
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
  const visibleModels = useMemo(
    () => projection.connections.flatMap((connection) => expanded.has(connection.id) ? connection.models : []),
    [expanded, projection.connections]
  )
  const initialIndex = Math.max(0, visibleModels.findIndex((model) => model.id === projection.selectedModelId))
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

  if (!selected) return null

  const selectActive = () => {
    const model = visibleModels[activeIndex]
    if (!model) return
    onSelect(model.id)
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
      setActiveIndex((current) => (current + direction + visibleModels.length) % visibleModels.length)
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
        connectionName={selected.connection.name}
        controls={menuId}
        modelName={selected.model.name}
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
                  const modelIndex = visibleModels.findIndex((candidate) => candidate.id === model.id)
                  return (
                    <ModelOptionItem
                      active={modelIndex === activeIndex}
                      key={model.id}
                      model={model}
                      onSelect={() => {
                        onSelect(model.id)
                        setMenuOpen(false)
                      }}
                      selected={model.id === projection.selectedModelId}
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
