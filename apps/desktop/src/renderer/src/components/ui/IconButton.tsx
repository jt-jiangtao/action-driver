import type { ButtonHTMLAttributes } from 'react'
import { AppIcon, type AppIconName } from './AppIcon'

export function IconButton({
  icon,
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: AppIconName }) {
  return (
    <button className={`ui-icon-button ${className}`.trim()} type={type} {...props}>
      <AppIcon name={icon} />
    </button>
  )
}
