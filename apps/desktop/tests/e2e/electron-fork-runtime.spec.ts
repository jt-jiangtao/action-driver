import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveElectronFork } from '../../../../scripts/lib/electron-fork.mjs'
import { getElectronForkExecutable } from './support/electron-fork'

const root = fileURLToPath(new URL('../../../../', import.meta.url))

test('desktop starts from the verified watermarked Electron Fork', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'actiondriver-fork-runtime-'))
  const artifact = await resolveElectronFork()
  expect(artifact.provenance.watermark).toMatchObject({
    enabled: true,
    developmentDefault: true,
    text: 'action-driver-dev'
  })
  const application = await electron.launch({
    executablePath: await getElectronForkExecutable(),
    args: ['.', `--user-data-dir=${join(directory, 'data')}`],
    cwd: join(root, 'apps/desktop'),
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))),
      HOME: directory,
      ACTIONDRIVER_E2E_HOME_DIRECTORY: directory
    }
  })
  try {
    expect(await application.evaluate(() => process.execPath)).toBe(artifact.executablePath)
    const page = await application.firstWindow()
    await expect(page).toHaveTitle('ActionDriver')
    await expect(page.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
    const windowId = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('No native window for watermark capture')
      return window.getMediaSourceId().split(':')[1]
    })
    const screenshots = join(root, 'thirdparty/build/verification/watermark')
    mkdirSync(screenshots, { recursive: true })
    execFileSync('/usr/sbin/screencapture', [
      '-x', '-o', `-l${windowId}`, join(screenshots, 'development-actiondriver.png')
    ])
  } finally {
    await application.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
