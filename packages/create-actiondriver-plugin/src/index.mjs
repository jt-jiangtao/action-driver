#!/usr/bin/env node
import { resolve } from 'node:path'
import { generatePlugin } from './generate.mjs'
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npm create actiondriver-plugin <plugin-id> [--directory <path>]')
} else {
  const id = args.shift()
  let directory = id
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--directory') { console.error('Unknown arguments; use --help'); process.exit(1) }
    directory = args[1]
  }
  try {
    await generatePlugin({ id, directory })
    console.log(`Created ${id} in ${resolve(directory)}. Run npm install, npm test, then npm pack.`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
