import { open, readdir } from 'node:fs/promises'
import type { ToolCall, ToolDefinition, ToolExecutor } from '@actiondriver/runtime-contracts'
import type { SandboxPathGuard } from './path-guard'

type SandboxTool = { definition: ToolDefinition; executor: ToolExecutor }

export function createSandboxFileTools(
  guard: SandboxPathGuard,
  limits: { maxListEntries?: number; maxReadBytes?: number } = {}
): { list: SandboxTool; read: SandboxTool } {
  const maxListEntries = limits.maxListEntries ?? 1_000
  const maxReadBytes = limits.maxReadBytes ?? 1024 * 1024
  return {
    list: {
      definition: {
        id: 'sandbox.fs.list', version: 1, modelName: 'sandbox_fs_list',
        description: 'List direct entries in a workspace directory',
        inputSchema: {
          type: 'object', properties: { path: { type: 'string' } },
          required: ['path'], additionalProperties: false
        },
        risk: 'low', sideEffects: { filesystem: 'read', network: false }, timeoutMs: 10_000
      },
      executor: {
        async *execute(call: ToolCall) {
          const path = String(call.arguments.path)
          const resolved = await guard.resolveExisting(path)
          const entries = await readdir(resolved.absolutePath, { withFileTypes: true })
          const sorted = entries
            .map((entry) => ({
              name: entry.name,
              type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'symlink'
            }))
            .sort((left, right) => left.name.localeCompare(right.name))
          yield {
            kind: 'result',
            output: {
              path: resolved.relativePath,
              entries: sorted.slice(0, maxListEntries),
              truncated: sorted.length > maxListEntries,
              totalEntries: sorted.length
            }
          }
        }
      }
    },
    read: {
      definition: {
        id: 'sandbox.fs.read', version: 1, modelName: 'sandbox_fs_read',
        description: 'Read UTF-8 text from a workspace file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            start: { type: 'integer', minimum: 0 },
            end: { type: 'integer', minimum: 0 }
          },
          required: ['path'], additionalProperties: false
        },
        risk: 'low', sideEffects: { filesystem: 'read', network: false }, timeoutMs: 10_000
      },
      executor: {
        async *execute(call: ToolCall) {
          const path = String(call.arguments.path)
          const resolved = await guard.resolveExisting(path)
          const file = await open(resolved.absolutePath, 'r')
          try {
            const stats = await file.stat()
            if (!stats.isFile()) throw new Error('SANDBOX_NOT_FILE')
            const start = typeof call.arguments.start === 'number' ? call.arguments.start : 0
            const requestedEnd = typeof call.arguments.end === 'number'
              ? call.arguments.end : stats.size
            const end = Math.min(stats.size, requestedEnd, start + maxReadBytes)
            if (start > stats.size || end < start) throw new Error('SANDBOX_RANGE_INVALID')
            const buffer = Buffer.alloc(end - start)
            const { bytesRead } = await file.read(buffer, 0, buffer.length, start)
            yield {
              kind: 'result',
              output: {
                path: resolved.relativePath,
                content: buffer.subarray(0, bytesRead).toString('utf8'),
                encoding: 'utf-8',
                range: { start, end: start + bytesRead },
                size: stats.size,
                truncated: start + bytesRead < requestedEnd
              }
            }
          } finally {
            await file.close()
          }
        }
      }
    }
  }
}
