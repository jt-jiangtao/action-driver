import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { extractPageText } from '../../src/web-open/extract'

describe('tools_local_web_open text extraction', () => {
  it('extracts an article title and Chinese body text', () => {
    const html = `<html><head><title>站点标题</title></head><body>
      <nav>导航入口</nav><article><h1>文章标题</h1><p>${'这是一段公开网页正文。'.repeat(60)}</p></article>
      <script>window.secret = '执行脚本';</script></body></html>`
    const result = extractPageText(html, 'https://example.com/story')
    expect(result.title).toContain('文章标题')
    expect(result.text).toContain('公开网页正文')
    expect(result.text).not.toContain('导航入口')
    expect(result.text).not.toContain('执行脚本')
    expect(result.url).toBe('https://example.com/story')
    expect(result.truncated).toBe(false)
  })

  it('falls back to a cleaned short page without executing scripts or loading resources', () => {
    const result = extractPageText(
      `<html><head><title>公告</title></head><body>
      <nav>首页 设置</nav><main><p>服务将于明日维护。</p></main>
      <script>fetch('http://127.0.0.1/private')</script>
      <img src="http://127.0.0.1/image.png"></body></html>`,
      'https://example.com/news'
    )
    expect(result.title).toBe('公告')
    expect(result.text).toBe('服务将于明日维护。')
  })

  it('truncates the text by Unicode characters', () => {
    const result = extractPageText(
      '<html><body><p>😀😀😀😀😀😀</p></body></html>',
      'https://example.com/emoji',
      4
    )
    expect(result.text).toBe('😀😀😀😀')
    expect(result.truncated).toBe(true)
  })

  it('rejects an empty page and uses the hostname as a title fallback', () => {
    expect(() =>
      extractPageText('<html><body><script>secret()</script></body></html>', 'https://example.com')
    ).toThrow('WEB_OPEN_EMPTY_CONTENT')
    const result = extractPageText('<html><body>Visible text</body></html>', 'https://example.com')
    expect(result.title).toBe('example.com')
  })

  it('does not execute page scripts or fetch images, stylesheets and scripts', async () => {
    let requests = 0
    const server = createServer((_request, response) => {
      requests += 1
      response.end('resource')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('TEST_SERVER_INVALID')
      const origin = `http://127.0.0.1:${address.port}`
      const result = extractPageText(
        `<html><head>
        <link rel="stylesheet" href="${origin}/style.css">
        <script src="${origin}/script.js"></script>
        </head><body><main>原始正文</main>
        <img src="${origin}/image.png">
        <script>document.body.textContent = '脚本改写';</script>
        </body></html>`,
        'https://example.com/page'
      )
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(result.text).toBe('原始正文')
      expect(requests).toBe(0)
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })
})
