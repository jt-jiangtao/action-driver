// Compatibility adapter: business logic and schema belong to the plugin package.
import { createSearxngSearchTool as createSearch } from '@actiondriver/web-plugin/search'
export { parseSearxngEndpoint } from '@actiondriver/web-plugin/search'
type SearchOptions = Parameters<typeof createSearch>[0]
export function createSearxngSearchTool(options: Omit<SearchOptions, 'fetch'> & { fetch?: SearchOptions['fetch'] }) {
  return createSearch({ ...options, fetch: options.fetch ?? globalThis.fetch })
}
