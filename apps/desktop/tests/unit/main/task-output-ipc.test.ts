import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TASK_OUTPUT_OPEN_CHANNEL } from '../../../src/shared/task-output-contract'
import { registerTaskOutputIpc } from '../../../src/main/task-output-ipc'

function fixture(
  response: Response | Error,
  openPath: (path: string) => Promise<string> = async () => ''
) {
  const handlers = new Map<string, (_event: unknown, input: unknown) => Promise<unknown>>()
  const fetched: string[] = []
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'action-driver-open-ipc-'))
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

  it('opens a resource URI through the runtime resource endpoint instead of a local path', async () => {
    const openPath = vi.fn<(path: string) => Promise<string>>(async () => '')
    const harness = fixture(
      new Response(
        JSON.stringify({
          ok: true,
          value: {
            uri: 'adr://v1/generated-output/file-1?task=task-1&session=session-1',
            version: '1',
            contentType: 'application/pdf',
            base64: Buffer.from('%PDF-1.7 resource bytes').toString('base64')
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ),
      openPath
    )
    try {
      await expect(
        harness.open({
          uri: 'adr://v1/generated-output/file-1?task=task-1&session=session-1',
          taskId: 'task-1',
          sessionId: 'session-1'
        })
      ).resolves.toEqual({ opened: true })
      expect(harness.fetched[0]).toContain('http://127.0.0.1:45123/resources/read')
      expect(harness.fetched[0]).toContain('Bearer service-token')
      const opened = String(openPath.mock.calls[0]?.[0])
      expect(opened.endsWith('.pdf')).toBe(true)
      expect(readFileSync(opened, 'utf8')).toBe('%PDF-1.7 resource bytes')
    } finally {
      harness.cleanup()
    }
  })

  it('refuses a raw path, a foreign URL or a malformed resource URI before any fetch', async () => {
    const openPath = vi.fn<(path: string) => Promise<string>>(async () => '')
    const harness = fixture(new Response('nope', { status: 500 }), openPath)
    try {
      for (const uri of [
        '/etc/passwd',
        '../../secrets.pdf',
        'file:///etc/passwd',
        'https://example.com/x.pdf',
        'adr://v1/generated-output/../../etc/passwd',
        'adr://v2/generated-output/file-1',
        'adr://v1/generated-output/file-1#fragment'
      ]) {
        await expect(harness.open({ uri, taskId: 'task-1', sessionId: 'session-1' })).rejects.toThrow(
          'TASK_OUTPUT_REQUEST_INVALID'
        )
      }
      await expect(
        harness.open({
          uri: 'adr://v1/generated-output/file-1',
          fileId: 'file-1',
          taskId: 'task-1',
          sessionId: 'session-1'
        })
      ).rejects.toThrow('TASK_OUTPUT_REQUEST_INVALID')
      expect(harness.fetched).toHaveLength(0)
      expect(openPath).not.toHaveBeenCalled()
    } finally {
      harness.cleanup()
    }
  })
})
