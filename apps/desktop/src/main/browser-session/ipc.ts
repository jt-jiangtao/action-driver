import type { BrowserSessionCommand, BrowserSessionSnapshot } from '@actiondriver/browser-desktop'
import {
  BROWSER_SESSION_COMMAND_CHANNEL,
  type BrowserSessionRequest
} from '../../shared/browser-session-contract.js'
import type { createTaskBrowserBinding } from './task-binding.js'

type Binding = ReturnType<typeof createTaskBrowserBinding>
type Ipc = { handle(channel: string,
  handler: (event: unknown, input: unknown) => Promise<unknown>): void }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
function point(value: unknown): boolean {
  return record(value) && finite(value.x) && finite(value.y)
}
function invalid(): never { throw new Error('BROWSER_IPC_INVALID') }

function validCommand(value: unknown): value is BrowserSessionCommand {
  if (!record(value)) return false
  switch (value.type) {
    case 'create-tab': case 'select-tab': case 'close-tab':
    case 'back': case 'forward': case 'refresh': return true
    case 'screenshot': return (value.fullPage === undefined || typeof value.fullPage === 'boolean') &&
      (value.clip === undefined || (point(value.clip) && record(value.clip) &&
        finite(value.clip.width) && finite(value.clip.height) &&
        value.clip.width > 0 && value.clip.height > 0))
    case 'click': return point(value) &&
      (value.button === undefined || value.button === 1 || value.button === 2 || value.button === 3)
    case 'double-click': case 'move': return point(value)
    case 'drag': return Array.isArray(value.path) && value.path.length >= 2 &&
      value.path.every(point)
    case 'keypress': return Array.isArray(value.keys) && value.keys.length === 1 &&
      typeof value.keys[0] === 'string' && value.keys[0].length <= 32
    case 'scroll': return finite(value.x) && finite(value.y) &&
      finite(value.deltaX) && finite(value.deltaY)
    case 'type': return typeof value.text === 'string' && value.text.length <= 100_000
    case 'navigate': {
      if (typeof value.url !== 'string' || value.url.length > 2_048) return false
      try {
        const url = new URL(value.url)
        return (url.protocol === 'http:' || url.protocol === 'https:') &&
          !url.username && !url.password
      } catch { return false }
    }
    default: return false
  }
}

export function parseBrowserSessionRequest(value: unknown): BrowserSessionRequest {
  if (!record(value) || !id(value.taskId)) return invalid()
  switch (value.action) {
    case 'open':
      if (value.surface !== 'embedded' && value.surface !== 'external-chrome') return invalid()
      return value as BrowserSessionRequest
    case 'snapshot': return value as BrowserSessionRequest
    case 'close':
      if (!id(value.sessionId)) return invalid()
      return value as BrowserSessionRequest
    case 'transition':
      if (!id(value.sessionId) || !['pause', 'take-over', 'resume'].includes(String(value.control)))
        return invalid()
      return value as BrowserSessionRequest
    case 'execute':
      if (!id(value.sessionId) || !id(value.tabId) || !validCommand(value.command))
        return invalid()
      return value as BrowserSessionRequest
    default: return invalid()
  }
}

export function registerBrowserSessionIpc(
  ipc: Ipc,
  binding: Binding,
  isTrustedSender: (event: unknown) => boolean,
  emit: (taskId: string, snapshot: BrowserSessionSnapshot | null) => void
): void {
  ipc.handle(BROWSER_SESSION_COMMAND_CHANNEL, async (event, input) => {
    if (!isTrustedSender(event)) throw new Error('BROWSER_IPC_UNTRUSTED')
    const request = parseBrowserSessionRequest(input)
    switch (request.action) {
      case 'open': {
        const snapshot = await binding.open(request.taskId, request.surface)
        emit(request.taskId, snapshot)
        return snapshot
      }
      case 'execute': {
        await binding.execute(request.taskId, request.sessionId, request.tabId,
          request.command, 'user')
        const snapshot = await binding.snapshot(request.taskId)
        if (snapshot) emit(request.taskId, snapshot)
        return snapshot
      }
      case 'transition': {
        const snapshot = await binding.transition(request.taskId, request.sessionId,
          request.control)
        emit(request.taskId, snapshot)
        return snapshot
      }
      case 'snapshot': return binding.snapshot(request.taskId)
      case 'close':
        await binding.close(request.taskId, request.sessionId)
        emit(request.taskId, null)
        return null
    }
  })
}
