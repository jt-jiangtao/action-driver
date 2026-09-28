import { createServer, type Server } from 'node:http'

export async function startLocalOtelCollector(): Promise<{
  endpoint: string
  close(): Promise<void>
}> {
  const server: Server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200)
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Expected TCP test server')
  }
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  }
}
