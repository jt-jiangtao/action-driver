import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  ArrowUp,
  Blocks,
  Boxes,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Cpu,
  Ellipsis,
  Eye,
  Folder,
  Globe2,
  Hand,
  Link,
  ListTodo,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Minimize2,
  MoreVertical,
  MousePointer2,
  Network,
  PanelLeft,
  PanelRight,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Trash2,
  WandSparkles,
  X
} from 'lucide-react'

export type AppIconName =
  | 'arrow-left'
  | 'check'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'circle-alert'
  | 'close'
  | 'ellipsis'
  | 'eye'
  | 'folder'
  | 'globe'
  | 'link'
  | 'loader'
  | 'lock'
  | 'mcp'
  | 'maximize'
  | 'minimize'
  | 'more-vertical'
  | 'panel-left'
  | 'panel-right'
  | 'pause'
  | 'play'
  | 'plus'
  | 'pointer'
  | 'refresh'
  | 'search'
  | 'send'
  | 'server'
  | 'settings'
  | 'skill'
  | 'takeover'
  | 'task'
  | 'trash'
  | 'network'
  | 'cpu'
  | 'boxes'

const iconByName: Record<AppIconName, LucideIcon> = {
  'arrow-left': ArrowLeft,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'circle-alert': CircleAlert,
  close: X,
  ellipsis: Ellipsis,
  eye: Eye,
  folder: Folder,
  globe: Globe2,
  link: Link,
  loader: LoaderCircle,
  lock: LockKeyhole,
  mcp: Blocks,
  maximize: Maximize2,
  minimize: Minimize2,
  'more-vertical': MoreVertical,
  'panel-left': PanelLeft,
  'panel-right': PanelRight,
  pause: Pause,
  play: Play,
  plus: Plus,
  pointer: MousePointer2,
  refresh: RefreshCw,
  search: Search,
  send: ArrowUp,
  server: Server,
  settings: Settings,
  skill: WandSparkles,
  takeover: Hand,
  task: ListTodo,
  trash: Trash2,
  network: Network,
  cpu: Cpu,
  boxes: Boxes
}

export function AppIcon({ name, size = 16, className }: { name: AppIconName; size?: number; className?: string }) {
  const Icon = iconByName[name]
  return (
    <Icon
      aria-hidden="true"
      className={className}
      color="currentColor"
      data-color="currentColor"
      size={size}
      strokeWidth={1.8}
    />
  )
}
