import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TASK_OUTPUT_OPEN_CHANNEL } from '../shared/task-output-contract'
import { registerTaskOutputIpc } from './task-output-ipc'

function fixture(
  response: Response | Error,
  openPath: (path: string) => Promise<string> = async () => ''
) {
  const handlers = new Map<string, (_event: unknown, input: unknown) => Promise<unknown>>()
  const fetched: string[] = []
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'actiondriver-open-ipc-'))
  registerTaskOutputIpc(
    {
      handle(channel, handler) {
        handlers.set(channel, handler)
      }
    },
    {
      connection: async () => ({ serviceUrl: 'http://127.0.0.1:45123', token: 'service-token' }),
      openPath,
      temporaryRoot,
      fetchImpl: (async (url: string, init?: RequestInit) => {
        fetched.push(`${url} ${String((init?.headers as Record<string, string>).authorization)}`)
        if (response instanceof Error) throw response
        return response
      }) as unknown as typeof fetch
    }
  )
  return {
    handlers,
    fetched,
    temporaryRoot,
    open: (input: unknown) => handlers.get(TASK_OUTPUT_OPEN_CHANNEL)!(null, input),
    cleanup: () => rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

describe('task output open bridge', () => {
  it('fetches the registered version with the service token and opens a temporary copy', async () => {
    const openPath = vi.fn<(path: string) => Promise<string>>(async () => '')
    const harness = fixture(
      new Response('%PDF-1.7 bytes', {
        status: 200,
        headers: { 'content-type': 'application/pdf' }
      }),
      openPath
    )
    try {
      await expect(
        harness.open({ fileId: 'file-1', taskId: 'task-1', sessionId: 'session-1' })
      ).resolves.toEqual({ opened: true })
      expect(harness.fetched[0]).toContain(
        '/sessions/session-1/outputs/file-1/content?taskId=task-1'
      )
      expect(harness.fetched[0]).toContain('Bearer service-token')
      const opened = String(openPath.mock.calls[0]?.[0])
      expect(opened.endsWith('.pdf')).toBe(true)
      expect(readFileSync(opened, 'utf8')).toBe('%PDF-1.7 bytes')
    } finally {
      harness.cleanup()
    }
  })

  it('refuses unknown identifiers, missing outputs and system open failures', async () => {
    const harness = fixture(new Response('missing', { status: 404 }))
    try {
      await expect(
        harness.open({ fileId: '../etc/passwd', taskId: 'task-1', sessionId: 's' })
      ).rejects.toThrow('TASK_OUTPUT_REQUEST_INVALID')
      await expect(harness.open({ fileId: 'file-1' })).rejects.toThrow(
        'TASK_OUTPUT_REQUEST_INVALID'
      )
      await expect(
        harness.open({ fileId: 'file-1', taskId: 'task-2', sessionId: 'session-1' })
      ).rejects.toThrow('TASK_OUTPUT_UNAVAILABLE')
    } finally {
      harness.cleanup()
    }

    const failing = fixture(
      new Response('%PDF-1.7', { status: 200, headers: { 'content-type': 'application/pdf' } }),
      async () => 'no application can open this file'
    )
    try {
      await expect(
        failing.open({ fileId: 'file-1', taskId: 'task-1', sessionId: 'session-1' })
      ).rejects.toThrow('no application can open this file')
    } finally {
      failing.cleanup()
    }
  })
})
