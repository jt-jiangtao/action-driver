import { spawn, type SpawnOptions } from 'node:child_process'
export interface CommandOptions extends SpawnOptions {
  check?: boolean
  input?: string | Uint8Array
  quiet?: boolean
}
export interface CommandResult {
  command: string
  code: number
  stdout: string
  stderr: string
  output: string
}
export function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const { check = true, input, quiet = false, ...spawnOptions } = options
    const display = [command, ...args].join(' ')
    if (!quiet) console.debug(`[cwd=${spawnOptions.cwd ?? process.cwd()}] ❯ ${display}`)
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...spawnOptions,
      env: { ...process.env, ...spawnOptions.env }
    })
    if (input !== undefined && child.stdin === null) {
      reject(new Error(`${display} missing stdin pipe`))
      return
    }
    let stdout = '',
      stderr = '',
      output = ''
    child.stdin?.end(input)
    child.stdout?.on('data', (chunk) => {
      const text = String(chunk)
      stdout += text
      output += text
    })
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk)
      stderr += text
      output += text
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      const result = {
        command,
        code: code ?? 1,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        output: output.trimEnd()
      }
      if (check && result.code !== 0)
        reject(
          new Error(`${display} (${code === null ? `signal=${signal}` : `exit=${result.code}`})`)
        )
      else resolve(result)
    })
  })
}
