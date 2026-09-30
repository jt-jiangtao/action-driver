import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export function copyComputerUseResources(binDirectory, resourceDirectory) {
  const name = 'ProductComputerUse_ComputerUseCore.bundle'
  const source = join(binDirectory, name)
  if (!existsSync(join(source, 'Contents', 'Resources', 'app-instructions.json'))) {
    throw new Error(`Missing Computer Use resource bundle: ${source}`)
  }
  const destination = join(resourceDirectory, name)
  mkdirSync(resourceDirectory, { recursive: true })
  rmSync(destination, { recursive: true, force: true })
  cpSync(source, destination, { recursive: true })
}
