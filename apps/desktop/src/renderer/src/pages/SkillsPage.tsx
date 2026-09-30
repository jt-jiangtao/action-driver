import { useCallback, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingsSidebar } from '../components/SettingsSidebar'
import type { EditorSaveState } from '../components/settings/AgentMarkdownEditor'
import type {
  AgentFileNode,
  AgentFilesService,
  AgentSkillSummary,
  AgentTextFile
} from '../models/agent-files'
import { SkillActionDialog, type SkillActionKind } from './skills/SkillActionDialog'
import { SkillDetailDialog } from './skills/SkillDetailDialog'
import { SkillListPanel } from './skills/SkillListPanel'

export const SKILLS_QUERY_KEY = ['skills'] as const

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Skills settings page. The list lives in the Query cache only; the selected Skill is derived
 * from the list by id, so a refresh can never leave a stale detail summary behind.
 */
export function SkillsPage({
  service,
  onBack,
  onOpenConnections,
  onOpenMainPrompt,
  onOpenComputerUse,
  onOpenArchived
}: {
  service: AgentFilesService
  onBack(): void
  onOpenConnections?(): void
  onOpenMainPrompt?(): void
  onOpenComputerUse?(): void
  onOpenArchived?(): void
}) {
  const queryClient = useQueryClient()
  const skillsQuery = useQuery({
    queryKey: SKILLS_QUERY_KEY,
    queryFn: () => service.listSkills(),
    staleTime: 30_000,
    retry: false
  })
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [tree, setTree] = useState<AgentFileNode[]>([])
  const [file, setFile] = useState<AgentTextFile | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [saveState, setSaveState] = useState<EditorSaveState>('saved')
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<SkillActionKind | null>(null)
  const [installUrl, setInstallUrl] = useState('')
  const [dialogName, setDialogName] = useState('')
  const [dialogDescription, setDialogDescription] = useState('')
  const [dialogBusy, setDialogBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [pendingSkillId, setPendingSkillId] = useState<string | null>(null)
  const lastTriggerRef = useRef<HTMLElement | null>(null)

  const skills = skillsQuery.data ?? null
  const listLoadError = skillsQuery.error ? errorMessage(skillsQuery.error) : null
  const selectedSkill = skills?.find((candidate) => candidate.id === selectedSkillId) ?? null

  /** Precise cache invalidation for one mutation, awaited so callers see the refreshed list. */
  const refreshSkills = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY, refetchType: 'none' })
    return await queryClient.fetchQuery({
      queryKey: SKILLS_QUERY_KEY,
      queryFn: () => service.listSkills(),
      staleTime: 0,
      retry: false
    })
  }, [queryClient, service])

  const closeSkillDetail = () => {
    setSelectedSkillId(null)
    setFile(null)
    setSelectedAsset(null)
    setActionMenuOpen(false)
    requestAnimationFrame(() => lastTriggerRef.current?.focus())
  }

  const openFile = async (path: string) => {
    if (/\.(?:png|jpe?g|gif|webp|ico|pdf|zip)$/i.test(path)) {
      setFile(null)
      setSelectedAsset(path)
      setError(null)
      return
    }
    try {
      const nextFile = await service.readFile(path)
      setFile(nextFile)
      setSelectedAsset(null)
      setValue(nextFile.content)
      setSaveState('saved')
      setError(null)
    } catch (readError) {
      setError(errorMessage(readError))
    }
  }

  const openSkill = async (skill: AgentSkillSummary) => {
    try {
      const nextTree = await service.getSkillTree(skill.id)
      setSelectedSkillId(skill.id)
      setTree(nextTree)
      setSelectedAsset(null)
      const firstFile = nextTree.find((node) => node.kind === 'file')
      if (firstFile) await openFile(firstFile.path)
    } catch (openError) {
      setError(errorMessage(openError))
    }
  }

  const toggleSkill = async (skill: AgentSkillSummary) => {
    const previous = queryClient.getQueryData<AgentSkillSummary[]>(SKILLS_QUERY_KEY) ?? null
    setPendingSkillId(skill.id)
    queryClient.setQueryData<AgentSkillSummary[]>(SKILLS_QUERY_KEY, (current) =>
      (current ?? []).map((item) =>
        item.id === skill.id ? { ...item, enabled: !item.enabled } : item
      )
    )
    try {
      await service.setSkillEnabled(skill.id, !skill.enabled)
      await refreshSkills()
    } catch (toggleError) {
      queryClient.setQueryData(SKILLS_QUERY_KEY, previous)
      setError(errorMessage(toggleError))
    } finally {
      setPendingSkillId(null)
    }
  }

  const saveFile = async () => {
    if (!file || !selectedSkill) return
    setSaveState('saving')
    try {
      const saved = await service.saveFile({
        path: file.path,
        content: value,
        expectedDigest: file.digest
      })
      setFile(saved)
      setValue(saved.content)
      setError(null)
      if (saved.path.endsWith('/SKILL.md')) await refreshSkills()
      setSaveState('saved')
    } catch (saveError) {
      setSaveState('error')
      setError(errorMessage(saveError))
    }
  }

  const closeDialog = () => {
    if (dialogBusy) return
    setDialog(null)
    setDialogName('')
    setDialogDescription('')
    setInstallUrl('')
    setDialogError(null)
  }

  const submitDialog = async () => {
    setDialogBusy(true)
    setDialogError(null)
    try {
      if (dialog === 'create') {
        await service.createSkill({ name: dialogName, description: dialogDescription })
        await refreshSkills()
      } else if (dialog === 'install-github') {
        await service.installSkill({ source: 'github', url: installUrl.trim() })
        await refreshSkills()
      } else if (dialog === 'rename' && selectedSkill) {
        const renamed = await service.renameSkill(selectedSkill.id, dialogName)
        setSelectedSkillId(renamed.id)
        await refreshSkills()
      } else if (dialog === 'delete' && selectedSkill) {
        await service.deleteSkill(selectedSkill.id)
        closeSkillDetail()
        await refreshSkills()
      }
      setDialogBusy(false)
      closeDialog()
    } catch (dialogSubmitError) {
      setDialogError(errorMessage(dialogSubmitError))
    } finally {
      setDialogBusy(false)
    }
  }

  const installLocalSkill = async () => {
    setAddMenuOpen(false)
    try {
      const path = await service.chooseLocalSkillFolder()
      if (!path) return
      await service.installSkill({ source: 'local', path })
      await refreshSkills()
    } catch (installError) {
      setError(errorMessage(installError))
    }
  }

  const dialogNameError =
    dialogName.length > 0 && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dialogName.trim())
      ? '仅支持小写英文、数字和单个连字符'
      : null

  return (
    <div className="settings-shell" data-testid="e2e/settings/skills/page#page">
      <SettingsSidebar
        onBack={onBack}
        active="skills"
        {...(onOpenConnections ? { onOpenConnections } : {})}
        {...(onOpenMainPrompt ? { onOpenMainPrompt } : {})}
        {...(onOpenComputerUse ? { onOpenComputerUse } : {})}
        {...(onOpenArchived ? { onOpenArchived } : {})}
      />
      <main className="settings-main agent-settings-main">
        <div className="settings-main-topbar" aria-hidden="true" />
        <div className="settings-main-scroll is-skills">
        <div className="agent-page">
          <SkillListPanel
            skills={skills}
            loadError={listLoadError}
            query={query}
            pendingSkillId={pendingSkillId}
            addMenuOpen={addMenuOpen}
            inert={Boolean(selectedSkill)}
            onQueryChange={setQuery}
            onRetry={() => void skillsQuery.refetch()}
            onBrowse={() => {
              void service.browseSkillDirectory().catch((browseError: unknown) => {
                setError(errorMessage(browseError))
              })
            }}
            onCreate={() => setDialog('create')}
            onToggleAddMenu={setAddMenuOpen}
            onInstallGithub={() => {
              setAddMenuOpen(false)
              setDialog('install-github')
            }}
            onInstallLocal={() => void installLocalSkill()}
            onOpenSkill={(skill, trigger) => {
              lastTriggerRef.current = trigger
              void openSkill(skill)
            }}
            onToggleSkill={(skill) => void toggleSkill(skill)}
          />
          {selectedSkill ? (
            <SkillDetailDialog
              skill={selectedSkill}
              tree={tree}
              file={file}
              selectedAsset={selectedAsset}
              value={value}
              saveState={saveState}
              error={error}
              pendingSkillId={pendingSkillId}
              actionMenuOpen={actionMenuOpen}
              onClose={closeSkillDetail}
              onToggleEnabled={() => void toggleSkill(selectedSkill)}
              onToggleActionMenu={() => setActionMenuOpen((open) => !open)}
              onReveal={() => {
                setActionMenuOpen(false)
                void service.revealSkillFolder(selectedSkill.id).catch((openError: unknown) => {
                  setError(errorMessage(openError))
                })
              }}
              onCopyMarkdown={() => {
                setActionMenuOpen(false)
                void (async () => {
                  try {
                    const entry = tree.find((node) => node.name === 'SKILL.md')
                    if (!entry) return
                    const markdown = await service.readFile(entry.path)
                    await navigator.clipboard.writeText(markdown.content)
                  } catch (copyError) {
                    setError(errorMessage(copyError))
                  }
                })()
              }}
              onRename={() => {
                setActionMenuOpen(false)
                setDialogName(selectedSkill.name)
                setDialog('rename')
              }}
              onDelete={() => {
                setActionMenuOpen(false)
                setDialog('delete')
              }}
              onOpenFile={(path) => void openFile(path)}
              onChangeValue={(nextValue) => {
                setValue(nextValue)
                setSaveState(nextValue === file?.content ? 'saved' : 'dirty')
              }}
              onSave={() => void saveFile()}
            />
          ) : null}
          {error && !selectedSkill ? (
            <div className="agent-inline-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
        </div>
      </main>
      {dialog ? (
        <SkillActionDialog
          kind={dialog}
          name={dialogName}
          description={dialogDescription}
          installUrl={installUrl}
          busy={dialogBusy}
          error={dialogError}
          nameError={dialogNameError}
          targetName={selectedSkill?.name ?? ''}
          onSubmit={() => void submitDialog()}
          onClose={closeDialog}
          onNameChange={setDialogName}
          onDescriptionChange={setDialogDescription}
          onInstallUrlChange={setInstallUrl}
        />
      ) : null}
    </div>
  )
}
