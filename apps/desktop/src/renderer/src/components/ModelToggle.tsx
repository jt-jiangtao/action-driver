export function ModelToggle({
  label,
  testId,
  checked,
  disabled = false,
  onChange
}: {
  label: string
  testId: string
  checked: boolean
  disabled?: boolean
  onChange(checked: boolean): void
}) {
  return (
    <button
      className="model-switch"
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      data-checked={checked ? 'true' : 'false'}
      data-testid={testId}
      onClick={() => onChange(!checked)}
    />
  )
}
