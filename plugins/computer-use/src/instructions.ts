// Verbatim OpenAI instruction snapshots; see ../SOURCE.md.
import description from '../instructions/description.md?raw'
import disabledBrowser from '../instructions/disabledBrowser.md?raw'
import computer from '../instructions/computer.md?raw'
import output from '../instructions/output.md?raw'
import reset from '../instructions/reset.md?raw'
import codeDescription from '../instructions/codeDescription.md?raw'
export { default as skillContent } from '../skills/computer-use/SKILL.md?raw'
export const instructions = { description, disabledBrowser, computer, output, reset, codeDescription }
