import { PluginError } from '@actiondriver/plugin-contracts'
import type { PluginHostAPIPorts } from './host-api'

export function createWebCredentialPort(environment: NodeJS.ProcessEnv) {
  const keys = {
    tavily: environment.TAVILY_API_KEY?.trim(),
    jina: environment.JINA_API_KEY?.trim()
  }
  const tools = { tavily: 'tools.local.web.search', jina: 'tools.local.web.open' }
  const credentials: NonNullable<PluginHostAPIPorts['credentials']> = {
    async request(owner, input, context) {
      const id = input.id as keyof typeof tools,
        tool = tools[id]
      if (
        owner.pluginId !== 'web' ||
        !tool ||
        context.chain.at(-1) !== tool ||
        !context.grants?.includes(`${tool}@1`)
      )
        throw new PluginError(
          'AUTHORIZATION_DENIED',
          'Web credential is not authorized for this invocation'
        )
      const key = keys[id]
      if (!key) throw new PluginError('UNAVAILABLE', 'Web credential is not configured')
      return key
    }
  }
  return {
    configuration: { searchConfigured: Boolean(keys.tavily), readerConfigured: Boolean(keys.jina) },
    credentials
  }
}
