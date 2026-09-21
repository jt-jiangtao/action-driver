export function ModelToggle({
  label,
  testId,
  checked,
  onChange
}: {
  label: string
  testId: string
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
      data-testid={testId}
      onClick={() => onChange(!checked)}
    />
  )
}
