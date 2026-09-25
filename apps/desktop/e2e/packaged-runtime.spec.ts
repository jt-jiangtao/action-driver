import { expect, test, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { FakeOpenAiToolServer } from './support/fake-openai-tool-server'

const appPath = process.env.ACTIONDRIVER_PACKAGED_APP
test.skip(!appPath, 'Set ACTIONDRIVER_PACKAGED_APP to a macOS application bundle')

test('packaged macOS app boots its bundled Runtime and authenticates the Renderer', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'actiondriver-packaged-data-'))
  const home = mkdtempSync(join(tmpdir(), 'actiondriver-packaged-home-'))
  const workspace = join(userData, 'workspace')
  mkdirSync(workspace, { recursive: true })
  writeFileSync(join(workspace, 'README.md'), 'needle is present in the packaged workspace\n')
  const provider = new FakeOpenAiToolServer('triple')
  await provider.start()
  const application = await electron.launch({
    executablePath: join(appPath!, 'Contents', 'MacOS', 'ActionDriver'),
    args: [`--user-data-dir=${userData}`],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      HOME: home,
      PATH: '/usr/bin:/bin',
      ACTIONDRIVER_E2E_HOME_DIRECTORY: home
    }
  })
  try {
    const runtime = await application.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      defaultApp: process.defaultApp
    }))
    expect(runtime.isPackaged, JSON.stringify(runtime)).toBe(true)
    const page = await application.firstWindow()
    await expect(page.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
    expect(page.url()).toBe('actiondriver://renderer/index.html')
    const result = await page.evaluate(async () => {
      const connection = await window.actionDriverDesktop.runtimeConnection.get()
      const url = new URL(connection.wsUrl)
      url.protocol = 'http:'
      url.pathname = '/model-connections'
      const authorized = await fetch(url, {
        headers: { Authorization: `Bearer ${connection.accessToken}` }
      })
      const unauthorized = await fetch(url)
      return { authorized: authorized.status, unauthorized: unauthorized.status }
    })
    expect(result).toEqual({ authorized: 200, unauthorized: 401 })
    const packagedSkills = await page.evaluate(async () => {
      const connection = await window.actionDriverDesktop.runtimeConnection.get()
      const url = new URL(connection.wsUrl)
      url.protocol = 'http:'
      url.pathname = '/agent-files/skills'
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${connection.accessToken}` }
      })
      return response.json() as Promise<{
        ok: boolean
        value: Array<{ id: string; source: string }>
      }>
    })
    expect(packagedSkills.ok).toBe(true)
    expect(packagedSkills.value).toEqual(
      expect.arrayContaining(
        ['browser-tools', 'computer-tools', 'imagegen', 'report-writer', 'skill-creator'].map((id) =>
          expect.objectContaining({ id, source: 'builtin' })
        )
      )
    )
    const root = join(appPath!, 'Contents', 'Resources', 'agent-runtime', 'dist')
    const target = join(root, 'runtimes', `darwin-${process.arch}`)
    const env = { ...process.env, HOME: '/nonexistent-actiondriver-home', PATH: '/usr/bin:/bin' }
    const python = join(target, 'python', 'bin', 'python3')
    const node = join(target, 'node', 'bin', 'node')
    const py = execFileSync(
      python,
      ['-c', 'import json,sys; print(json.dumps({"executable":sys.executable}))'],
      { env, encoding: 'utf8' }
    )
    const js = execFileSync(
      node,
      [
        '-e',
        "console.log(JSON.stringify({executable:process.execPath, builtIn:require('node:fs')!==undefined}))"
      ],
      { env, encoding: 'utf8' }
    )
    const shell = execFileSync('/bin/zsh', ['-c', 'printf needle | rg needle'], {
      env: { ...env, PATH: `${join(root, 'bin')}:/usr/bin:/bin` },
      encoding: 'utf8'
    })
    const bundled = {
      root,
      py: JSON.parse(py) as { executable: string },
      js: JSON.parse(js) as { executable: string; builtIn: boolean },
      shell
    }
    expect(bundled.py.executable).toContain(bundled.root)
    expect(bundled.js.executable).toContain(bundled.root)
    expect(bundled.js.builtIn).toBe(true)
    expect(bundled.shell).toContain('needle')
    await page.evaluate(async (baseUrl) => {
      const connection = await window.actionDriverDesktop.runtimeConnection.get()
      const url = new URL(connection.wsUrl)
      url.protocol = 'http:'
      url.pathname = '/model-connections'
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          draft: {
            name: 'Packaged Tool Provider',
            protocol: 'openai-compatible',
            baseUrl,
            apiKey: 'sk-packaged-test'
          },
          models: [
            { id: 'e2e-tool-model', name: 'e2e-tool-model', enabled: true, testState: 'success' }
          ]
        })
      })
      if (!response.ok || !((await response.json()) as { ok: boolean }).ok)
        throw new Error('Packaged model setup failed')
    }, provider.baseUrl)
    await page.reload()
    await page.getByLabel('任务描述').fill('依次测试 Python、Node 和 Shell')
    await page.getByLabel('发送').click()
    await expect(page.getByRole('heading', { name: '已读取' })).toBeVisible({ timeout: 30_000 })
    expect(provider.completions).toHaveLength(4)
    const modelTools = provider.completions[0]?.tools?.map((tool) => tool.function?.name)
    expect(modelTools).toEqual(
      expect.arrayContaining(['shell_run', 'python_run', 'node_run', 'ts_run'])
    )
    const messages = JSON.stringify(provider.completions.at(-1)?.messages)
    expect(messages).toContain(root)
    expect(messages).toContain('needle is present')
    provider.setMode('python-blocking')
    await page.getByLabel('任务描述').fill('运行长时间 Python 脚本并等待取消')
    await page.getByLabel('发送').click()
    await expect(page.locator('.activity-tool.is-running')).toHaveCount(1, { timeout: 15_000 })
    await page.getByLabel('中断任务').click()
    await expect(page.getByTestId('e2e/shared/composer/root#section')).toHaveAttribute(
      'data-state',
      'idle'
    )
    expect(provider.completions).toHaveLength(1)
    provider.setMode('vision')
    await page.reload()
    await page.getByLabel('添加图片').setInputFiles({
      name: 'tiny.png',
      mimeType: 'image/png',
      buffer: readFileSync(
        join(process.cwd(), 'apps', 'agent-runtime', 'tests', 'fixtures', 'tiny.png')
      )
    })
    await page.getByLabel('任务描述').fill('识别图片')
    await page.getByLabel('发送').click()
    await expect(page.getByText('识别到了图片')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('img', { name: '上传的图片' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('img', { name: '上传的图片' })).toBeVisible()
  } finally {
    await application.close()
    await provider.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})
