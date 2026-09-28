import { realpath } from 'node:fs/promises'
import { dirname, resolve, join, relative, isAbsolute, sep } from 'node:path'
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    const parent = dirname(path)
    if (parent === path) throw e
    return join(await canonical(parent), path.slice(parent.length + 1))
  }
}
export async function assertOutputOutside(
  root: string,
  output: string,
  protectedInputs: string[]
): Promise<void> {
  const source = await realpath(root)
  const target = await canonical(resolve(output))
  const rel = relative(source, target)
  if (!rel || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel)))
    throw new Error('Output overlaps vendor baseline')
  for (const input of protectedInputs)
    if (target === (await canonical(resolve(input))))
      throw new Error('Output overlaps protected input')
}
