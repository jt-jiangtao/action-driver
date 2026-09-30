import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SettingsSidebar } from '../components/SettingsSidebar'
import {
  AgentMarkdownEditor,
  type EditorSaveState
} from '../components/settings/AgentMarkdownEditor'
import type { AgentFilesService, AgentTextFile } from '../models/agent-files'

export function MainPromptPage({
  service,
  onBack,
  onOpenConnections,
  onOpenSkills,
  onOpenComputerUse,
  onOpenArchived
}: {
  service: AgentFilesService
  onBack(): void
  onOpenConnections?(): void
  onOpenSkills?(): void
  onOpenComputerUse?(): void
  onOpenArchived?(): void
}) {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<AgentTextFile | null>(null)
  const [value, setValue] = useState('')
  const [saveState, setSaveState] = useState<EditorSaveState>('saved')
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'restore' | 'leave' | null>(null)
  const pendingNavigation = useRef<(() => void) | null>(null)

  const load = useCallback(
    async (refresh = false) => {
      try {
        if (refresh)
          await queryClient.invalidateQueries({ queryKey: ['main-prompt'], refetchType: 'none' })
        const loaded = await queryClient.fetchQuery({
          queryKey: ['main-prompt'],
          queryFn: () => service.getMainPrompt(),
          staleTime: 30_000,
          retry: false
        })
        setFile(loaded)
        setValue(loaded.content)
        setSaveState('saved')
        setError(null)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      }
    },
    [queryClient, service]
  )

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(async () => {
    if (!file) return false
    setSaveState('saving')
    try {
      const saved = await service.saveFile({
        path: file.path,
        content: value,
        expectedDigest: file.digest
      })
      queryClient.setQueryData(['main-prompt'], saved)
      setFile(saved)
      setValue(saved.content)
      setSaveState('saved')
      setError(null)
      return true
    } catch (saveError) {
      setSaveState('error')
      setError(saveError instanceof Error ? saveError.message : String(saveError))
      return false
    }
  }, [file, queryClient, service, value])

  const requestNavigation = useCallback(
    (navigate?: () => void) => {
      if (!navigate) return
      if (saveState === 'dirty' || saveState === 'error') {
        pendingNavigation.current = navigate
        setDialog('leave')
        return
      }
      navigate()
    },
    [saveState]
  )

  const finishNavigation = useCallback(() => {
    const navigate = pendingNavigation.current
    pendingNavigation.current = null
    setDialog(null)
    navigate?.()
  }, [])

  return (
    <div className="settings-shell" data-testid="e2e/settings/main-prompt/page#page">
      <SettingsSidebar
        onBack={() => requestNavigation(onBack)}
        beforeNavigate={requestNavigation}
        active="main-prompt"
        {...(onOpenConnections
          ? { onOpenConnections: () => requestNavigation(onOpenConnections) }
          : {})}
        {...(onOpenSkills ? { onOpenSkills: () => requestNavigation(onOpenSkills) } : {})}
        {...(onOpenComputerUse
          ? { onOpenComputerUse: () => requestNavigation(onOpenComputerUse) }
          : {})}
        {...(onOpenArchived ? { onOpenArchived: () => requestNavigation(onOpenArchived) } : {})}
      />
      <main className="settings-main agent-settings-main">
        <div className="settings-main-topbar" aria-hidden="true" />
        <div className="settings-main-scroll is-main-prompt">
        <div className="agent-page">
          <header className="agent-page-header">
            <div>
              <h1>主提示词</h1>
              <p>编辑 Agent 的默认行为、边界和执行原则。</p>
            </div>
            <button
              className="agent-secondary-button"
              data-testid="e2e/settings/main-prompt/restore#button"
              type="button"
              disabled={!file || saveState === 'saving'}
              onClick={() => setDialog('restore')}
            >
              恢复默认
            </button>
          </header>
          <div className="agent-path-bar">
            <span>.action-driver</span>
            <span>/</span>
            <strong>prompts</strong>
            <span>/</span>
            <strong>main.md</strong>
          </div>
          {file ? (
            <AgentMarkdownEditor
              path={file.path}
              value={value}
              saveState={saveState}
              ariaLabel="主提示词 Markdown"
              onChange={(nextValue) => {
                setValue(nextValue)
                setSaveState(nextValue === file.content ? 'saved' : 'dirty')
              }}
              onSave={async () => {
                await save()
              }}
            />
          ) : error ? null : (
            <div className="agent-loading">正在读取主提示词…</div>
          )}
          {error ? (
            <div className="agent-inline-error" role="alert">
              {error}
              <button
                data-testid="e2e/settings/main-prompt/reload#button"
                type="button"
                onClick={() => void load(true)}
              >
                重新加载
              </button>
            </div>
          ) : null}
        </div>
        </div>
      </main>
      {dialog === 'restore' && file ? (
        <div className="agent-dialog-backdrop">
          <section
            className="agent-dialog is-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-main-prompt-title"
          >
            <header>
              <div>
                <h2 id="restore-main-prompt-title">恢复默认主提示词？</h2>
                <p>当前内容将被内置默认提示词替换，此操作保存后不可撤销。</p>
              </div>
            </header>
            <footer>
              <button
                className="agent-secondary-button"
                data-testid="e2e/settings/main-prompt/restore-cancel#button"
                type="button"
                onClick={() => setDialog(null)}
              >
                取消
              </button>
              <button
                className="agent-primary-button"
                data-testid="e2e/settings/main-prompt/restore-confirm#button"
                type="button"
                onClick={async () => {
                  setSaveState('saving')
                  try {
                    const restored = await service.resetMainPrompt(file.digest)
                    queryClient.setQueryData(['main-prompt'], restored)
                    setFile(restored)
                    setValue(restored.content)
                    setSaveState('saved')
                    setError(null)
                    setDialog(null)
                  } catch (restoreError) {
                    setSaveState('error')
                    setError(
                      restoreError instanceof Error ? restoreError.message : String(restoreError)
                    )
                    setDialog(null)
                  }
                }}
              >
                确认恢复
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {dialog === 'leave' ? (
        <div className="agent-dialog-backdrop">
          <section
            className="agent-dialog is-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-main-prompt-title"
          >
            <header>
              <div>
                <h2 id="leave-main-prompt-title">离开主提示词？</h2>
                <p>你有尚未保存的更改。保存后离开，或放弃本次更改。</p>
              </div>
            </header>
            <footer>
              <button
                className="agent-secondary-button"
                data-testid="e2e/settings/main-prompt/leave-cancel#button"
                type="button"
                onClick={() => {
                  pendingNavigation.current = null
                  setDialog(null)
                }}
              >
                取消
              </button>
              <button
                className="agent-secondary-button"
                data-testid="e2e/settings/main-prompt/discard-leave#button"
                type="button"
                onClick={finishNavigation}
              >
                放弃更改
              </button>
              <button
                className="agent-primary-button"
                data-testid="e2e/settings/main-prompt/save-leave#button"
                type="button"
                onClick={async () => {
                  if (await save()) finishNavigation()
                }}
              >
                保存并离开
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}
