import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cloneGitSkill, parseGithubSkillUrl } from '../../src/agent-files/skill-source'

const run = promisify(execFile)

describe('GitHub Skill source', () => {
  it('parses repository root and selected subdirectory', () => {
    expect(parseGithubSkillUrl('https://github.com/acme/tools')).toEqual({
      owner: 'acme', repo: 'tools', ref: null, subdir: ''
    })
    expect(parseGithubSkillUrl('https://github.com/acme/tools/tree/main/skills/review')).toEqual({
      owner: 'acme', repo: 'tools', ref: 'main', subdir: 'skills/review'
    })
    expect(() => parseGithubSkillUrl('https://evil.example/acme/tools')).toThrow()
    expect(() => parseGithubSkillUrl('https://github.com/acme/tools/tree/main/../secret')).toThrow()
  })

  it('copies only the selected directory from a Git repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'action-driver-git-skill-'))
    const repository = join(root, 'repo')
    const destination = join(root, 'destination', 'review')
    await mkdir(join(repository, 'skills', 'review'), { recursive: true })
    await writeFile(join(repository, 'skills', 'review', 'SKILL.md'), '# Review\n\nReview changes.\n')
    await writeFile(join(repository, 'outside.txt'), 'outside')
    await run('git', ['init', '-q', repository])
    await run('git', ['-C', repository, 'add', '.'])
    await run('git', ['-C', repository, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'])
    await cloneGitSkill({ repository, ref: null, subdir: 'skills/review', destination })
    expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toContain('Review changes.')
    await expect(readFile(join(destination, 'outside.txt'))).rejects.toThrow()
  })

  it('uses existing Git configuration for a private-repository credential stand-in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'action-driver-git-auth-'))
    const repository = join(root, 'private-repo')
    const destination = join(root, 'installed', 'private-skill')
    const gitConfig = join(root, 'gitconfig')
    await mkdir(join(repository, 'skills', 'private-skill'), { recursive: true })
    await writeFile(join(repository, 'skills', 'private-skill', 'SKILL.md'), '# Private Skill\n')
    await run('git', ['init', '-q', repository])
    await run('git', ['-C', repository, 'add', '.'])
    await run('git', ['-C', repository, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'])
    await writeFile(gitConfig, `[url "file://${repository}"]\n\tinsteadOf = https://github.com/acme/private.git\n`)
    await cloneGitSkill({
      repository: 'https://github.com/acme/private.git', ref: null,
      subdir: 'skills/private-skill', destination,
      environment: { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' }
    })
    expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toContain('Private Skill')
  })
})
