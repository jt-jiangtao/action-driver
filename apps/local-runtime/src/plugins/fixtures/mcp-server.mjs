import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
const server = new McpServer({ name: 'fixture', version: '1.0.0' })
server.registerTool('echo', { inputSchema: { value: z.string() } }, async ({ value }) => ({ content: [{ type: 'text', text: `${value}:${process.env.ACTION_DRIVER_TEST_GLOBAL_CREDENTIAL ? 'leaked' : 'isolated'}` }] }))
await server.connect(new StdioServerTransport())
