import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
const mcp = new McpServer({ name: 'http-fixture', version: '1.0.0' })
mcp.registerTool('echo', { inputSchema: { value: z.string() } }, async ({ value }) => ({ content: [{ type: 'text', text: value }] }))
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID })
await mcp.connect(transport)
const server = createServer(async (req, res) => {
  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const data = Buffer.concat(chunks).toString('utf8')
    await transport.handleRequest(req, res, data ? JSON.parse(data) : undefined)
  } catch { res.writeHead(500); res.end() }
})
server.listen(0, '127.0.0.1', () => process.send?.({ port: server.address().port }))
process.on('disconnect', () => { server.closeAllConnections(); server.close(); process.exit(0) })
