import { SidebarEntry } from './SidebarEntry'

export function SettingsNavEntry({ onClick }: { onClick?(): void }) {
  return (
    <SidebarEntry
      icon="settings"
      label="设置"
      testId="e2e/shared/sidebar/settings#button"
      {...(onClick ? { onClick } : {})}
    />
  )
}
