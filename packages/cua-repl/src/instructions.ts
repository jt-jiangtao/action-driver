import { readFileSync } from 'node:fs'
export interface InstructionSet {
  description: string
  browser: string
  computer: string
  output: string
  browserDisabled: string
  computerDisabled: string
  server: string
  code: string
  reset: string
}
export const instructionsRoot = new URL('../resources/instructions/', import.meta.url)
export function loadInstructions(
  platform: string,
  browserEnvironment?: string,
  root: URL = instructionsRoot
): InstructionSet {
  const directory = platform === 'darwin' ? 'macos' : undefined
  if (!directory) throw new Error(`unsupported cua_repl platform=${platform}`)
  const read = (name: string) => readFileSync(new URL(`${name}.md`, root), 'utf8').trimEnd()
  return {
    description: read(`${directory}/description`),
    browser: read(
      `${directory}/${browserEnvironment === 'cloud' || browserEnvironment === 'orbit' ? 'browser-cloud' : 'browser'}`
    ),
    computer: read(`${directory}/computer`),
    output: read(`${directory}/output`),
    browserDisabled: read('browser-disabled'),
    computerDisabled: read('computer-disabled'),
    server: read('server'),
    code: read('code'),
    reset: read('reset')
  }
}
