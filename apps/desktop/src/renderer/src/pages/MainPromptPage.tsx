import { useCallback, useEffect, useState } from 'react'
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
  onOpenLogs
}: {
  service: AgentFilesService
  onBack(): void
  onOpenConnections?(): void
  onOpenSkills?(): void
  onOpenLogs?(): void
}) {
  const [file, setFile] = useState<AgentTextFile | null>(null)
  const [value, setValue] = useState('')
  const [saveState, setSaveState] = useState<EditorSaveState>('saved')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const loaded = await service.getMainPrompt()
      setFile(loaded)
      setValue(loaded.content)
      setSaveState('saved')
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [service])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="settings-shell" data-testid="e2e/settings/main-prompt/page#page">
      <SettingsSidebar
        onBack={onBack}
        active="main-prompt"
        {...(onOpenConnections ? { onOpenConnections } : {})}
        {...(onOpenSkills ? { onOpenSkills } : {})}
        {...(onOpenLogs ? { onOpenLogs } : {})}
      />
      <main className="settings-main agent-settings-main">
        <div className="agent-page">
          <header className="agent-page-header">
            <div>
              <h1>主提示词</h1>
              <p>编辑 Agent 的默认行为、边界和执行原则。</p>
            </div>
          </header>
          <div className="agent-path-bar">
            <span>.action-driver</span><span>/</span><strong>prompts</strong><span>/</span><strong>main.md</strong>
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
                setSaveState('saving')
                try {
                  const saved = await service.saveFile({
                    path: file.path,
                    content: value,
                    expectedDigest: file.digest
                  })
                  setFile(saved)
                  setValue(saved.content)
                  setSaveState('saved')
                  setError(null)
                } catch (saveError) {
                  setSaveState('error')
                  setError(saveError instanceof Error ? saveError.message : String(saveError))
                }
              }}
            />
          ) : error ? null : <div className="agent-loading">正在读取主提示词…</div>}
          {error ? <div className="agent-inline-error" role="alert">{error}<button data-testid="e2e/settings/main-prompt/reload#button" type="button" onClick={() => void load()}>重新加载</button></div> : null}
        </div>
      </main>
    </div>
  )
}
