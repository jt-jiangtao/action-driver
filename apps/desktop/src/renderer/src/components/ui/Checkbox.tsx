import type { ReactNode } from 'react'
import { AppIcon } from './AppIcon'

export type CheckboxValue = boolean | 'indeterminate'

export function Checkbox({
  checked,
  disabled = false,
  children,
  onCheckedChange
}: {
  checked: CheckboxValue
  disabled?: boolean
  children?: ReactNode
  onCheckedChange(value: boolean): void
}) {
  return (
    <button
      aria-checked={checked === 'indeterminate' ? 'mixed' : checked}
      className="ui-checkbox"
      data-state={checked === 'indeterminate' ? 'indeterminate' : checked ? 'checked' : 'unchecked'}
      disabled={disabled}
      onClick={() => onCheckedChange(checked !== true)}
      role="checkbox"
      type="button"
    >
      <span className="ui-checkbox-box" aria-hidden="true">
        {checked === true ? <AppIcon name="check" size={12} /> : null}
        {checked === 'indeterminate' ? <span className="ui-checkbox-dash" /> : null}
      </span>
      {children ? <span>{children}</span> : null}
    </button>
  )
}
