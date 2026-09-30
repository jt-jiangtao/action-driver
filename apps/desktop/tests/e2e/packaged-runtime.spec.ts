import { expect, test, _electron as electron } from '@playwright/test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { FakeOpenAiToolServer } from './support/fake-openai-tool-server'

const appPath = process.env.ACTION_DRIVER_PACKAGED_APP
test.skip(!appPath, 'Set ACTION_DRIVER_PACKAGED_APP to a macOS application bundle')

/** Reads the newest tool result the fake provider received, whatever turn order the app used. */
function latestToolPayload(provider: FakeOpenAiToolServer): {
  ok: boolean
  output?: { stdout?: string; stderr?: string }
  error?: { message?: string }
} {
  const turn = [...provider.completions]
    .reverse()
    .find((completion) => completion.messages.some((message) => message.role === 'tool'))
  const message = turn?.messages.find((candidate) => candidate.role === 'tool')
  return JSON.parse(String(message?.content ?? '{}')) as {
    ok: boolean
    output?: { stdout?: string; stderr?: string }
    error?: { message?: string }
  }
}

test('packaged macOS app boots its bundled Runtime and authenticates the Renderer', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'action-driver-packaged-data-'))
  const home = mkdtempSync(join(tmpdir(), 'action-driver-packaged-home-'))
  const workspace = join(userData, 'workspace')
  mkdirSync(workspace, { recursive: true })
  writeFileSync(join(workspace, 'README.md'), 'needle is present in the packaged workspace\n')
  const provider = new FakeOpenAiToolServer('triple')
  await provider.start()
  const application = await electron.launch({
    executablePath: join(appPath!, 'Contents', 'MacOS', 'Action-Driver'),
    args: [`--user-data-dir=${userData}`],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      HOME: home,
      PATH: '/usr/bin:/bin',
      ACTION_DRIVER_E2E_HOME_DIRECTORY: home
    }
  })
  try {
    const runtime = await application.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      defaultApp: process.defaultApp,
      executablePath: process.execPath,
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      arch: process.arch
    }))
    expect(runtime.isPackaged, JSON.stringify(runtime)).toBe(true)
    const provenance = JSON.parse(
      readFileSync(join(appPath!, 'Contents', 'Resources', 'action-driver-electron-provenance.json'), 'utf8')
    )
    expect(runtime.executablePath).toBe(realpathSync(join(appPath!, 'Contents', 'MacOS', 'Action-Driver')))
    expect(runtime.electron).toBe(provenance.version)
    expect(runtime.chromium).toBe(provenance.chromiumVersion)
    expect(runtime.arch).toBe(provenance.arch)
    expect(provenance.repo).toBe('https://github.com/jt-jiangtao/electron.git')
    const page = await application.firstWindow()
    await expect(page.getByText('我们应该在 Action-Driver 中做些什么？')).toBeVisible()
    expect(page.url()).toBe('action-driver://renderer/index.html')
    const result = await page.evaluate(async () => {
      const connection = await window.productDesktop.runtimeConnection.get()
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
      const connection = await window.productDesktop.runtimeConnection.get()
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
        ['documents', 'pdf', 'imagegen', 'presentations', 'skill-creator'].map((id) =>
          expect.objectContaining({ id, source: 'plugin' })
        )
      )
    )
    expect(packagedSkills.value).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'computer-use', source: 'plugin' })]))
    const root = join(appPath!, 'Contents', 'Resources', 'local-runtime', 'dist')
    const target = join(root, 'runtimes', `darwin-${process.arch}`)
    const env = { ...process.env, HOME: '/nonexistent-action-driver-home', PATH: '/usr/bin:/bin' }
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
      const connection = await window.productDesktop.runtimeConnection.get()
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
      expect.arrayContaining(['tools_local_command_shell_run', 'tools_local_command_python_run', 'tools_local_command_node_run', 'tools_local_command_typescript_run'])
    )
    const messages = JSON.stringify(provider.completions.at(-1)?.messages)
    expect(messages).toContain(root)
    expect(messages).toContain('needle is present')
    const sessionOutputs = readdirSync(join(workspace, 'sessions'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(workspace, 'sessions', entry.name, 'output', 'README.md'))
      .filter((file) => existsSync(file))
    expect(sessionOutputs.length).toBeGreaterThan(0)

    provider.setMode('sandbox')
    await page.getByLabel('任务描述').fill('检查脚本沙箱')
    await page.getByLabel('发送').click()
    await expect.poll(() => provider.completions.length, { timeout: 30_000 }).toBe(2)
    const sandboxPayload = latestToolPayload(provider)
    expect(sandboxPayload.ok, JSON.stringify(sandboxPayload)).toBe(true)
    const sandboxReport = JSON.parse((sandboxPayload.output?.stdout ?? '').trim()) as {
      cwd: string
      inherited: string[]
    }
    expect(sandboxReport.cwd.startsWith(join(realpathSync(workspace), 'sessions'))).toBe(true)
    expect(sandboxReport.inherited).toEqual([])

    provider.setMode('sandbox-escape')
    await page.getByLabel('任务描述').fill('尝试读取会话外文件')
    await page.getByLabel('发送').click()
    await expect.poll(() => provider.completions.length, { timeout: 30_000 }).toBe(2)
    const escapeMessages = provider.completions.at(-1)?.messages ?? []
    expect(JSON.stringify(escapeMessages)).not.toContain(
      'needle is present in the packaged workspace'
    )
    const escapePayload = latestToolPayload(provider)
    expect(escapePayload.ok).toBe(false)

    provider.setMode('office')
    await page.getByLabel('任务描述').fill('检查随包 Office 依赖')
    await page.getByLabel('发送').click()
    await expect.poll(() => provider.completions.length, { timeout: 60_000 }).toBe(2)
    const officePayload = latestToolPayload(provider)
    const officeOutput = `${officePayload.output?.stdout ?? ''}\n${officePayload.output?.stderr ?? ''}`
    expect(officePayload.ok, JSON.stringify(officePayload)).toBe(true)
    expect(officeOutput).toContain('office-python-ok')

    provider.setMode('office-soffice')
    await page.getByLabel('任务描述').fill('检查随包 LibreOffice')
    await page.getByLabel('发送').click()
    await expect.poll(() => provider.completions.length, { timeout: 60_000 }).toBe(2)
    const sofficePayload = latestToolPayload(provider)
    expect(sofficePayload.ok, JSON.stringify(sofficePayload)).toBe(true)
    expect(sofficePayload.output?.stdout ?? '').toContain('LibreOffice')

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
        join(process.cwd(), 'apps', 'local-runtime', 'tests', 'fixtures', 'tiny.png')
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
