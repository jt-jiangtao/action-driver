import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { AppIcon, type AppIconName } from './AppIcon'

export type TextButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'
export type TextButtonState = 'default' | 'loading' | 'disabled'

export function TextButton({
  variant,
  state = 'default',
  icon,
  children,
  className = '',
  disabled,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: TextButtonVariant
  state?: TextButtonState
  icon?: AppIconName
  children: ReactNode
}) {
  const unavailable = disabled || state === 'disabled' || state === 'loading'
  return (
    <button
      aria-busy={state === 'loading'}
      className={`text-button text-button-${variant} ${className}`.trim()}
      data-state={state}
      disabled={unavailable}
      type={type}
      {...props}
    >
      {state === 'loading' ? <AppIcon className="ui-spin" name="loader" /> : null}
      {state !== 'loading' && icon ? <AppIcon name={icon} /> : null}
      <span>{children}</span>
    </button>
  )
}
