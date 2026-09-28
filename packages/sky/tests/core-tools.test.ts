// @vitest-environment node
import { expect, test } from 'vitest'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { originalModule } from '../../cua/tests/original-module'
import { runCommand } from '../src/core/command'
import { resolvePackageBin } from '../src/core/package-bin'
const root = resolve(
  'packages/back/codex-cua/@oai/sky/dist/project/cua/sky_js/src/core'
)
test('command stdout/stderr/stdin/env and exit result match original', async () => {
  const ref = await originalModule(join(root, 'cli.js'))
  const script =
    "process.stdin.setEncoding('utf8');let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{process.stdout.write(process.env.CUA_TEST_VALUE+':'+data+'\\n');setTimeout(()=>process.stderr.write('err\\n'),30)})"
  const options = {
    stdio: 'pipe' as const,
    input: 'input',
    env: { CUA_TEST_VALUE: 'value' },
    quiet: true
  }
  expect(await runCommand(process.execPath, ['-e', script], options)).toEqual(
    await ref.cli!(process.execPath, ['-e', script], options)
  )
  expect(
    await runCommand(process.execPath, ['-e', 'process.exit(7)'], { quiet: true, check: false })
  ).toMatchObject({ code: 7, stdout: '', stderr: '', output: '' })
  await expect(
    runCommand(process.execPath, ['-e', 'process.exit(7)'], { quiet: true })
  ).rejects.toThrow('exit=7')
  await expect(runCommand('/does-not-exist', [], { quiet: true })).rejects.toMatchObject({
    code: 'ENOENT'
  })
})
test('explicit input requires pipe and output is trimEnd rather than trim', async () => {
  await expect(
    runCommand(process.execPath, ['-e', ''], { input: 'input', quiet: true })
  ).rejects.toThrow('missing stdin pipe')
  expect(
    await runCommand(process.execPath, ['-e', "process.stdout.write('  text  \\n')"], {
      stdio: 'pipe',
      quiet: true
    })
  ).toMatchObject({ stdout: '  text', output: '  text' })
})
test('binary resolution locates nearest package and honors trimmed override without check', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cua-bin-'))
  try {
    const nested = join(directory, 'src', 'core')
    await mkdir(nested, { recursive: true })
    await writeFile(join(directory, 'package.json'), '{}')
    await writeFile(join(directory, 'tool'), '')
    let source = await readFile(join(root, 'package_bin.js'), 'utf8')
    source = source.replaceAll(
      'import.meta.url',
      JSON.stringify(pathToFileURL(join(nested, 'package_bin.js')).href)
    )
    const ref = await import(
      'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
    )
    const env = { CUA_BIN_OVERRIDE: ' /nonexistent ' }
    const saved = process.env.CUA_BIN_OVERRIDE
    process.env.CUA_BIN_OVERRIDE = env.CUA_BIN_OVERRIDE
    try {
      for (const relativePath of [['tool'], ['missing']])
        for (const checkExists of [true, false]) {
          const options = { relativePath, checkExists }
          if (relativePath[0] === 'missing' && checkExists) {
            expect(() => resolvePackageBin(options, { startDirectory: nested, env: {} })).toThrow()
            expect(() =>
              ref.package_bin({ relative_path: relativePath, check_exists: checkExists })
            ).toThrow()
          } else
            expect(resolvePackageBin(options, { startDirectory: nested, env: {} })).toBe(
              ref.package_bin({ relative_path: relativePath, check_exists: checkExists })
            )
        }
      expect(
        resolvePackageBin(
          { relativePath: ['missing'], envVarOverride: 'CUA_BIN_OVERRIDE' },
          { startDirectory: nested, env }
        )
      ).toBe(ref.package_bin({ relative_path: ['missing'], env_var_override: 'CUA_BIN_OVERRIDE' }))
    } finally {
      if (saved === undefined) delete process.env.CUA_BIN_OVERRIDE
      else process.env.CUA_BIN_OVERRIDE = saved
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
