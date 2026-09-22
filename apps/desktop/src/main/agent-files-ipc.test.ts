import { describe, expect, it, vi } from 'vitest'
import { AGENT_FILES_IPC_CHANNELS } from '../shared/agent-files-contract'
import { AgentFileStoreError, type AgentFileStore } from './agent-files/agent-file-store'
import { registerAgentFilesIpcHandlers } from './agent-files-ipc'

function createIpcMain() {
  const handlers = new Map<string, (event: unknown, input: unknown) => unknown>()
  return {
    handlers,
    handle(channel: string, handler: (event: unknown, input: unknown) => unknown) {
      handlers.set(channel, handler)
    }
  }
}

describe('Agent file IPC handlers', () => {
  it('registers every whitelisted operation and forwards typed input', async () => {
    const ipcMain = createIpcMain()
    const saveFile = vi.fn(async (input) => ({ ...input, digest: 'new', modifiedAt: 'now' }))
    const resetMainPrompt = vi.fn(async () => ({
      path: '.action-driver/prompts/main.md',
      content: '# Default',
      digest: 'reset',
      modifiedAt: 'now'
    }))
    registerAgentFilesIpcHandlers(ipcMain, {
      getMainPrompt: vi.fn(),
      resetMainPrompt,
      listSkills: vi.fn(),
      getSkillTree: vi.fn(),
      readFile: vi.fn(),
      saveFile,
      createSkill: vi.fn(),
      renameSkill: vi.fn(),
      deleteSkill: vi.fn(),
      setSkillEnabled: vi.fn()
    } as unknown as AgentFileStore)

    expect([...ipcMain.handlers.keys()].sort()).toEqual(
      Object.values(AGENT_FILES_IPC_CHANNELS).sort()
    )
    const input = {
      path: '.action-driver/prompts/main.md',
      content: 'updated',
      expectedDigest: 'old'
    }
    expect(
      await ipcMain.handlers.get(AGENT_FILES_IPC_CHANNELS.saveFile)!(undefined, input)
    ).toEqual({
      ok: true,
      value: { ...input, digest: 'new', modifiedAt: 'now' }
    })
    expect(saveFile).toHaveBeenCalledWith(input)
    expect(
      await ipcMain.handlers.get(AGENT_FILES_IPC_CHANNELS.resetMainPrompt)!(undefined, {
        expectedDigest: 'old'
      })
    ).toMatchObject({
      ok: true,
      value: { content: '# Default', digest: 'reset' }
    })
    expect(resetMainPrompt).toHaveBeenCalledWith('old')
  })

  it('serializes diagnostic errors without exposing implementation details', async () => {
    const ipcMain = createIpcMain()
    registerAgentFilesIpcHandlers(ipcMain, {
      getMainPrompt: () => {
        throw new AgentFileStoreError('PATH_REJECTED', 'outside root')
      }
    } as unknown as AgentFileStore)

    expect(
      await ipcMain.handlers.get(AGENT_FILES_IPC_CHANNELS.getMainPrompt)!(undefined, {})
    ).toEqual({
      ok: false,
      error: { code: 'PATH_REJECTED', message: 'outside root' }
    })
  })

  it('rejects calls from an untrusted renderer origin', async () => {
    const ipcMain = createIpcMain()
    registerAgentFilesIpcHandlers(ipcMain, { listSkills: () => [] } as unknown as AgentFileStore)

    expect(
      await ipcMain.handlers.get(AGENT_FILES_IPC_CHANNELS.listSkills)!(
        { senderFrame: { url: 'https://evil.example/settings' } },
        {}
      )
    ).toEqual({
      ok: false,
      error: { code: 'PATH_REJECTED', message: '不允许的 Agent 文件 IPC 来源。' }
    })
  })
})
