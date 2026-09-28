/** Extract protocol key mapping data, not executable runtime implementation. */
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const sourcePath =
  'apps/agent-runtime/vendor/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-service.mjs'
const source = await readFile(sourcePath, 'utf8')
const baseline = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      source + '\nexport {$g as keys,N4 as aliases,F4 as chords,M4 as macCommands};'
    ).toString('base64')
)
const data =
    JSON.stringify(
      Object.fromEntries(
        ['keys', 'aliases', 'chords', 'macCommands'].map((key) => [key, [...baseline[key]]])
      ),
      null,
      2
    ) + '\n',
  output = 'packages/browser-runtime/resources/browser-keyboard.json'
await writeFile(output, data)
await writeFile(
  'analysis/codex-cua/browser-keyboard-provenance.json',
  JSON.stringify(
    {
      sourcePath,
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      output,
      outputSha256: createHash('sha256').update(data).digest('hex'),
      kind: 'computed key mapping data; no executable implementation extracted'
    },
    null,
    2
  ) + '\n'
)
process.stdout.write(
  JSON.stringify({
    keys: baseline.keys.size,
    aliases: baseline.aliases.size,
    chords: baseline.chords.size
  }) + '\n'
)
