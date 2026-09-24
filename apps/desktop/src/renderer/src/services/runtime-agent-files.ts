import type { AgentFilesService, CreateAgentSkillInput, SaveAgentFileInput } from '../models/agent-files'
import { mapAgentFileError } from './desktop-agent-files'
import type { RuntimeHttpClient } from './runtime-http-client'

export class RuntimeAgentFilesService implements AgentFilesService {
  constructor(private readonly http: RuntimeHttpClient) {}

  private async call<T>(path: string, options?: { method: 'POST' | 'DELETE'; body?: unknown }): Promise<T> {
    try {
      return options
        ? await this.http.request<T>(path, options)
        : await this.http.request<T>(path)
    } catch (error) {
      throw mapAgentFileError(error)
    }
  }

  getMainPrompt() { return this.call<Awaited<ReturnType<AgentFilesService['getMainPrompt']>>>(
    '/agent-files/main-prompt') }
  resetMainPrompt(expectedDigest: string) { return this.call<Awaited<ReturnType<AgentFilesService['getMainPrompt']>>>(
    '/agent-files/main-prompt/reset', { method: 'POST', body: { expectedDigest } }) }
  listSkills() { return this.call<Awaited<ReturnType<AgentFilesService['listSkills']>>>(
    '/agent-files/skills') }
  getSkillTree(skillId: string) { return this.call<Awaited<ReturnType<AgentFilesService['getSkillTree']>>>(
    `/agent-files/skills/${encodeURIComponent(skillId)}/tree`) }
  readFile(path: string) { return this.call<Awaited<ReturnType<AgentFilesService['readFile']>>>(
    `/agent-files/file?path=${encodeURIComponent(path)}`) }
  saveFile(input: SaveAgentFileInput) { return this.call<Awaited<ReturnType<AgentFilesService['saveFile']>>>(
    '/agent-files/file', { method: 'POST', body: input }) }
  createSkill(input: CreateAgentSkillInput) { return this.call<Awaited<ReturnType<AgentFilesService['createSkill']>>>(
    '/agent-files/skills', { method: 'POST', body: input }) }
  renameSkill(skillId: string, name: string) { return this.call<Awaited<ReturnType<AgentFilesService['renameSkill']>>>(
    `/agent-files/skills/${encodeURIComponent(skillId)}/rename`, { method: 'POST', body: { name } }) }
  deleteSkill(skillId: string) { return this.call<void>(
    `/agent-files/skills/${encodeURIComponent(skillId)}`, { method: 'DELETE' }) }
  setSkillEnabled(skillId: string, enabled: boolean) {
    return this.call<Awaited<ReturnType<AgentFilesService['setSkillEnabled']>>>(
      `/agent-files/skills/${encodeURIComponent(skillId)}/enabled`,
      { method: 'POST', body: { enabled } }
    )
  }
}
