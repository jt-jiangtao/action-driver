import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolExecutorEvent } from '@actiondriver/runtime-contracts'
import { runProcess } from '../src/execution/process-runner'
import { createScriptTools } from '../src/execution/tools'
import {
  SandboxUnavailableError,
  SessionSandbox,
  type SandboxPrepared
} from '../src/execution/session-sandbox'
import { sessionWorkspacePaths } from '../src/execution/session-workspace'

const runtimeDist = join(process.cwd(), 'apps/agent-runtime/dist')
const node = join(runtimeDist, 'dependencies/node/bin/node')
const python = join(runtimeDist, 'dependencies/python/bin/python3')
const temporaryDirectories: string[] = []
const prepared: SandboxPrepared[] = []

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  for (const sandbox of prepared.splice(0)) await sandbox.dispose()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function sandbox(): SessionSandbox {
  return new SessionSandbox({ runtimeRoots: [runtimeDist] })
}

async function prepare(workspaceRoot: string, sessionId: string): Promise<SandboxPrepared> {
  const workspace = sessionWorkspacePaths(workspaceRoot, sessionId)
  mkdirSync(workspace.input, { recursive: true })
  mkdirSync(workspace.output, { recursive: true })
  const launch = await sandbox().prepare({ workspace })
  prepared.push(launch)
  return launch
}

async function run(
  launch: SandboxPrepared,
  executable: string,
  args: string[],
  cwd: string,
  stdin?: string
): Promise<{ output: string; exitCode: number | null }> {
  const command = launch.wrap(executable, args)
  let output = ''
  let exitCode: number | null = null
  try {
    for await (const event of runProcess({
      executable: command.executable,
      args: command.args,
      cwd,
      env: launch.environment,
      maxOutputBytes: 1024 * 1024,
      ...(stdin === undefined ? {} : { stdin })
    })) {
      const part = event as ToolExecutorEvent
      if (part.kind === 'content') output += part.delta
      if (part.kind === 'result') {
        exitCode = (part.output as { exitCode?: number }).exitCode ?? null
      }
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'exitCode' in error) {
      exitCode = (error as { exitCode: number | null }).exitCode
    } else throw error
  }
  return { output, exitCode }
}

describe('per-session macOS script sandbox', () => {
  it('refuses to run on a platform without a supported sandbox', async () => {
    const workspaceRoot = temporaryDirectory('actiondriver-sandbox-unsupported-')
    const workspace = sessionWorkspacePaths(workspaceRoot, 'session-a')
    mkdirSync(workspace.input, { recursive: true })
    mkdirSync(workspace.output, { recursive: true })

    const unsupported = new SessionSandbox({ runtimeRoots: [runtimeDist], platform: 'linux' })
    await expect(unsupported.prepare({ workspace })).rejects.toThrow(SandboxUnavailableError)
    await expect(unsupported.prepare({ workspace })).rejects.toMatchObject({
      code: 'SANDBOX_UNAVAILABLE'
    })

    const missingBinary = new SessionSandbox({
      runtimeRoots: [runtimeDist],
      sandboxExecPath: join(workspaceRoot, 'missing-sandbox-exec')
    })
    await expect(missingBinary.prepare({ workspace })).rejects.toMatchObject({
      code: 'SANDBOX_UNAVAILABLE'
    })
  })

  it('lets a bundled interpreter read its own input and write its own output', async () => {
    const workspaceRoot = temporaryDirectory('actiondriver-sandbox-own-')
    const launch = await prepare(workspaceRoot, 'session-a')
    const workspace = sessionWorkspacePaths(workspaceRoot, 'session-a')
    writeFileSync(join(workspace.input, 'notes.txt'), 'input-bytes')

    const result = await run(
      launch,
      node,
      [
        '-e',
        [
          "const fs = require('node:fs')",
          "const read = fs.readFileSync('input/notes.txt', 'utf8')",
          "fs.writeFileSync('output/result.txt', read + '-written')",
          "console.log(read, fs.readdirSync('output').length)"
        ].join('\n')
      ],
      workspace.root
    )

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('input-bytes')
  })

  it('denies reading another session workspace', async () => {
    const workspaceRoot = temporaryDirectory('actiondriver-sandbox-cross-')
    const launch = await prepare(workspaceRoot, 'session-a')
    const own = sessionWorkspacePaths(workspaceRoot, 'session-a')
    const other = sessionWorkspacePaths(workspaceRoot, 'session-b')
    mkdirSync(other.input, { recursive: true })
    mkdirSync(other.output, { recursive: true })
    writeFileSync(join(other.output, 'secret.txt'), 'other-session')

    const result = await run(
      launch,
      python,
      ['-c', `print(open('${join(other.output, 'secret.txt')}').read())`],
      own.root
    )

    expect(result.exitCode).not.toBe(0)
    expect(result.output).not.toContain('other-session')
  })

  it('denies application-private files outside the workspace', async () => {
    const workspaceRoot = temporaryDirectory('actiondriver-sandbox-private-')
    const launch = await prepare(workspaceRoot, 'session-a')
    const own = sessionWorkspacePaths(workspaceRoot, 'session-a')
    const privateDirectory = temporaryDirectory('actiondriver-sandbox-private-store-')
    writeFileSync(join(privateDirectory, 'actiondriver.db'), 'database-bytes')
    writeFileSync(join(privateDirectory, 'service-token'), 'token-bytes')

    for (const target of ['actiondriver.db', 'service-token']) {
      const result = await run(
        launch,
        node,
        [
          '-e',
          `console.log(require('node:fs').readFileSync('${join(privateDirectory, target)}', 'utf8'))`
        ],
        own.root
      )
      expect(result.exitCode).not.toBe(0)
      expect(result.output).not.toContain('bytes')
    }
  })

  it('denies writing outside the session output and refuses symlinked escapes', async () => {
    const workspaceRoot = temporaryDirectory('actiondriver-sandbox-write-')
    const launch = await prepare(workspaceRoot, 'session-a')
    const own = sessionWorkspacePaths(workspaceRoot, 'session-a')
    const outside = temporaryDirectory('actiondriver-sandbox-outside-')
    symlinkSync(outside, join(own.output, 'escape'))

    const outsideWrite = await run(
      launch,
      node,
      ['-e', `require('node:fs').writeFileSync('${join(outside, 'written.txt')}', 'nope')`],
      own.root
    )
    expect(outsideWrite.exitCode).not.toBe(0)

    const symlinkWrite = await run(
      launch,
      node,
      ['-e', "require('node:fs').writeFileSync('output/escape/bypass.txt', 'nope')"],
      own.root
    )
    expect(symlinkWrite.exitCode).not.toBe(0)
  })

  it('starts scripts with a minimal environment that carries no runtime secrets', async () => {
    const workspaceRoot = temporaryDirectory('actiondriver-sandbox-env-')
    const previousToken = process.env.ACTIONDRIVER_SERVICE_TOKEN
    const previousMarker = process.env.ACTIONDRIVER_TEST_SECRET
    process.env.ACTIONDRIVER_SERVICE_TOKEN = 'service-token-value'
    process.env.ACTIONDRIVER_TEST_SECRET = 'credential-value'
    try {
      const launch = await prepare(workspaceRoot, 'session-a')
      const own = sessionWorkspacePaths(workspaceRoot, 'session-a')
      const result = await run(
        launch,
        python,
        ['-c', 'import os; print(sorted(os.environ))'],
        own.root
      )

      expect(result.exitCode).toBe(0)
      expect(result.output).not.toContain('ACTIONDRIVER_SERVICE_TOKEN')
      expect(result.output).not.toContain('ACTIONDRIVER_TEST_SECRET')
      expect(result.output).not.toContain('service-token-value')
      expect(result.output).toContain('TMPDIR')
      expect(result.output).toContain('PATH')
    } finally {
      if (previousToken === undefined) delete process.env.ACTIONDRIVER_SERVICE_TOKEN
      else process.env.ACTIONDRIVER_SERVICE_TOKEN = previousToken
      if (previousMarker === undefined) delete process.env.ACTIONDRIVER_TEST_SECRET
      else process.env.ACTIONDRIVER_TEST_SECRET = previousMarker
    }
  })

  it('runs the bundled Office tooling inside the sandbox and writes deliverables', async () => {
    const workspaceRoot = temporaryDirectory('actiondriver-sandbox-office-')
    const workspace = sessionWorkspacePaths(workspaceRoot, 'session-a')
    mkdirSync(workspace.input, { recursive: true })
    mkdirSync(workspace.output, { recursive: true })
    const tools = await createScriptTools({ runtimeDist })
    const context = { taskId: 'task-a', sessionId: 'session-a', workspace }
    const execute = async (modelName: string, script: string): Promise<void> => {
      const tool = tools.find((candidate) => candidate.definition.modelName === modelName)!
      let output = ''
      try {
        for await (const event of tool.executor.execute(
          {
            callId: `call-${modelName}`,
            providerCallId: `provider-${modelName}`,
            modelName,
            arguments: { script }
          },
          undefined,
          context
        )) {
          if (event.kind === 'content') output += event.delta
        }
      } catch (error) {
        throw new Error(`${modelName} failed: ${String(error)}\n${output}`)
      }
    }

    // The Skills author their build files in the session workspace and link the
    // dependency tree; both must work under the sandbox.
    const build = join(workspace.output, 'build')
    mkdirSync(build, { recursive: true })
    symlinkSync(join(runtimeDist, 'dependencies/node/node_modules'), join(build, 'node_modules'))
    writeFileSync(
      join(build, 'create-docx.py'),
      [
        'from docx import Document',
        'document = Document()',
        "document.add_heading('Sandboxed Office Validation', 0)",
        "document.add_paragraph('Generated inside the per-session sandbox.')",
        "document.save('output/sample.docx')",
        "print('docx created')"
      ].join('\n')
    )
    writeFileSync(
      join(build, 'create-xlsx.mjs'),
      [
        "import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool'",
        'const workbook = Workbook.create()',
        "const sheet = workbook.worksheets.add('Summary')",
        "sheet.getRange('A1:B1').values = [[2, 3]]",
        "sheet.getRange('C1').formulas = [['=A1+B1']]",
        'workbook.recalculate()',
        "await (await SpreadsheetFile.exportXlsx(workbook)).save('output/sample.xlsx')",
        "const reopened = await SpreadsheetFile.importXlsx(await FileBlob.load('output/sample.xlsx'))",
        'reopened.recalculate()',
        "const result = reopened.worksheets.getItem('Summary').getRange('C1').values[0][0]",
        "if (result !== 5) throw new Error('formula result: ' + result)",
        "console.log('xlsx formula', result)"
      ].join('\n')
    )
    writeFileSync(
      join(build, 'create-pptx.mjs'),
      [
        "import { Presentation, PresentationFile } from '@oai/artifact-tool'",
        "const presentation = Presentation.create({ slideSize: { width: 1280, height: 720 } })",
        'const slide = presentation.slides.add()',
        "const title = slide.shapes.add({ geometry: 'textbox', position: { left: 70, top: 45, width: 1140, height: 85 }, fill: 'none', line: { fill: 'none', width: 0 } })",
        "title.text = 'Bundled deck validation'",
        "await (await PresentationFile.exportPptx(presentation)).save('output/sample-deck.pptx')",
        "console.log('pptx created')"
      ].join('\n')
    )
    writeFileSync(
      join(build, 'create-pdf.py'),
      [
        'from reportlab.pdfgen import canvas',
        'import pypdf',
        "pdf = canvas.Canvas('output/sample-report.pdf')",
        "pdf.drawString(72, 720, 'Bundled PDF validation')",
        'pdf.save()',
        "reader = pypdf.PdfReader('output/sample-report.pdf')",
        "assert len(reader.pages) == 1, len(reader.pages)",
        "assert 'Bundled PDF validation' in reader.pages[0].extract_text()",
        "print('pdf created')"
      ].join('\n')
    )

    await execute('tools_local_command_shell_run', '"$RUNTIME_PYTHON" output/build/create-docx.py')
    await execute(
      'tools_local_command_shell_run',
      'soffice --headless --convert-to pdf --outdir output output/sample.docx'
    )
    await execute('tools_local_command_shell_run', '"$RUNTIME_NODE" output/build/create-xlsx.mjs')
    await execute('tools_local_command_shell_run', '"$RUNTIME_NODE" output/build/create-pptx.mjs')
    await execute('tools_local_command_shell_run', '"$RUNTIME_PYTHON" output/build/create-pdf.py')

    expect(existsSync(join(workspace.output, 'sample.docx'))).toBe(true)
    expect(existsSync(join(workspace.output, 'sample.pdf'))).toBe(true)
    expect(existsSync(join(workspace.output, 'sample.xlsx'))).toBe(true)
    expect(existsSync(join(workspace.output, 'sample-deck.pptx'))).toBe(true)
    expect(existsSync(join(workspace.output, 'sample-report.pdf'))).toBe(true)
    expect(readFileSync(join(workspace.output, 'sample.pdf')).subarray(0, 4).toString()).toBe(
      '%PDF'
    )
  }, 120_000)

  it('cannot reach a local Runtime interface from inside the sandbox', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ sessions: ['session-b'] }))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as AddressInfo).port
    try {
      const workspaceRoot = temporaryDirectory('actiondriver-sandbox-local-')
      const launch = await prepare(workspaceRoot, 'session-a')
      const own = sessionWorkspacePaths(workspaceRoot, 'session-a')
      const result = await run(
        launch,
        python,
        [
          '-c',
          [
            'import socket, sys',
            'client = socket.socket()',
            'client.settimeout(3)',
            `client.connect(('127.0.0.1', ${port}))`,
            "print('connected')"
          ].join('\n')
        ],
        own.root
      )

      expect(result.exitCode).not.toBe(0)
      expect(result.output).not.toContain('connected')
      expect(result.output).not.toContain('session-b')
    } finally {
      server.close()
      await once(server, 'close')
    }
  })

  it('keeps the limits for processes a script starts', async () => {
    const workspaceRoot = temporaryDirectory('actiondriver-sandbox-child-')
    const launch = await prepare(workspaceRoot, 'session-a')
    const own = sessionWorkspacePaths(workspaceRoot, 'session-a')
    const other = sessionWorkspacePaths(workspaceRoot, 'session-b')
    mkdirSync(other.output, { recursive: true })
    writeFileSync(join(other.output, 'secret.txt'), 'other-session')

    const result = await run(
      launch,
      node,
      [
        '-e',
        [
          "const { spawnSync } = require('node:child_process')",
          `const child = spawnSync('${node}', ['-e', "process.stdout.write(require('node:fs').readFileSync('${join(other.output, 'secret.txt')}', 'utf8'))"], { encoding: 'utf8' })`,
          'console.log(JSON.stringify({ status: child.status, stdout: child.stdout, stderr: child.stderr.slice(0, 80) }))'
        ].join('\n')
      ],
      own.root
    )

    expect(result.output).not.toContain('other-session')
    expect(result.output).toContain('"status":1')
  })
})
