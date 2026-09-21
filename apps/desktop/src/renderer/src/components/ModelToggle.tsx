export function ModelToggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange(checked: boolean): void
}) {
  return (
    <button
      className="model-switch"
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      data-checked={checked ? 'true' : 'false'}
      onClick={() => onChange(!checked)}
    />
  )
}
