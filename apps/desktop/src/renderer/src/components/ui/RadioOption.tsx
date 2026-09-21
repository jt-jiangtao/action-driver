export function RadioOption({
  selected,
  title,
  description,
  onSelect
}: {
  selected: boolean
  title: string
  description: string
  onSelect(): void
}) {
  return (
    <button
      aria-checked={selected}
      className="ui-radio-option"
      data-selected={selected}
      onClick={onSelect}
      role="radio"
      type="button"
    >
      <span className="ui-radio-dot" aria-hidden="true" />
      <span className="ui-radio-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
    </button>
  )
}
