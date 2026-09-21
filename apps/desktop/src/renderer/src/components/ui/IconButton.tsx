import type { ButtonHTMLAttributes } from 'react'
import { AppIcon, type AppIconName } from './AppIcon'

export function IconButton({
  icon,
  testId,
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: AppIconName; testId: string }) {
  return (
    <button
      className={`ui-icon-button ${className}`.trim()}
      data-testid={testId}
      type={type}
      {...props}
    >
      <AppIcon name={icon} />
    </button>
  )
}
