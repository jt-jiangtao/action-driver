// Compatibility adapter: business logic and schema belong to the plugin package.
import { createSearxngSearchTool as createSearch } from '../../../../plugins/search/src/execution'
export { parseSearxngEndpoint } from '../../../../plugins/search/src/execution'
type SearchOptions = Parameters<typeof createSearch>[0]
export function createSearxngSearchTool(options: Omit<SearchOptions, 'fetch'> & { fetch?: SearchOptions['fetch'] }) {
  return createSearch({ ...options, fetch: options.fetch ?? globalThis.fetch })
}
