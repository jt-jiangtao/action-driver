import { execFile } from 'node:child_process'
import { cp, mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { AgentFileStoreError } from './agent-file-store'

const run = promisify(execFile)
const SEGMENT = /^[a-zA-Z0-9._-]+$/

export type GithubSkillLocation = {
  owner: string
  repo: string
  ref: string | null
  subdir: string
}

export function parseGithubSkillUrl(input: string): GithubSkillLocation {
  if (/(?:^|\/)(?:\.|%2e){2}(?:\/|$)/i.test(input)) {
    throw new AgentFileStoreError('VALIDATION', 'GitHub Skill 目录不能向上跳转。')
  }
  let url: URL
  try { url = new URL(input) } catch { throw new AgentFileStoreError('VALIDATION', 'GitHub URL 无效。') }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port || url.search || url.hash) {
    throw new AgentFileStoreError('VALIDATION', '仅支持 github.com 的 HTTPS 仓库地址。')
  }
  const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
  if (parts.length < 2 || parts.some((part) => !SEGMENT.test(part) || part === '.' || part === '..')) {
    throw new AgentFileStoreError('VALIDATION', 'GitHub 仓库或目录路径无效。')
  }
  const [owner, rawRepo, ...rest] = parts
  const repo = rawRepo!.replace(/\.git$/, '')
  if (!repo || (rest.length && (rest[0] !== 'tree' || rest.length < 2))) {
    throw new AgentFileStoreError('VALIDATION', 'GitHub Skill 地址应指向仓库或 tree 分支目录。')
  }
  const ref = rest.length ? rest[1]! : null
  const subdir = rest.slice(2).join('/')
  return { owner: owner!, repo, ref, subdir }
}

export async function cloneGitSkill({
  repository,
  ref,
  subdir,
  destination,
  environment = process.env
}: {
  repository: string
  ref: string | null
  subdir: string
  destination: string
  environment?: NodeJS.ProcessEnv
}): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'actiondriver-github-skill-'))
  const checkout = join(temporaryRoot, 'repo')
  try {
    const args = ['clone', '--quiet', '--depth', '1', '--filter=blob:none', '--sparse']
    if (ref) args.push('--branch', ref)
    args.push(repository, checkout)
    await run('git', args, { env: { ...environment, GIT_TERMINAL_PROMPT: '0' }, timeout: 60_000 })
    if (subdir) {
      await run('git', ['-C', checkout, 'sparse-checkout', 'set', '--', subdir], { timeout: 60_000 })
    }
    const selected = subdir ? join(checkout, subdir) : checkout
    if (!(await stat(selected)).isDirectory()) throw new AgentFileStoreError('NOT_FOUND', 'GitHub Skill 子目录不存在。')
    await mkdir(join(destination, '..'), { recursive: true })
    await cp(selected, destination, {
      recursive: true,
      errorOnExist: true,
      filter: (path) => basename(path) !== '.git'
    })
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    if (error instanceof AgentFileStoreError) throw error
    throw new AgentFileStoreError('IO_ERROR', '无法获取 GitHub Skill；请检查地址、网络或本机 Git 凭据。', error)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}
