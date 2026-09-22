import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { AppIcon } from '../ui/AppIcon'
import { e2eId } from '../../testing/e2e-id'
import { MarkdownVisualEditor } from './MarkdownVisualEditor'

export type EditorSaveState = 'saved' | 'dirty' | 'saving' | 'error'

export function AgentMarkdownEditor({
  path,
  value,
  onChange,
  onSave,
  saveState,
  ariaLabel
}: {
  path: string
  value: string
  onChange(value: string): void
  onSave(): void
  saveState: EditorSaveState
  ariaLabel: string
}) {
  const [sourceMode, setSourceMode] = useState(false)
  const editorId = ariaLabel === '主提示词 Markdown' ? 'main-prompt' : 'skill'
  const saveLabel =
    saveState === 'saved'
      ? '已保存'
      : saveState === 'saving'
        ? '保存中…'
        : saveState === 'error'
          ? '重试保存'
          : '保存更改'

  return (
    <section className="agent-editor-card">
      <header className="agent-editor-toolbar">
        <div className="agent-editor-path" title={path}>
          <AppIcon name="code" />
          <span>{path}</span>
        </div>
        <div className="agent-editor-actions">
          <div className="editor-mode-switch" role="group" aria-label="编辑器模式">
            <button
              className={!sourceMode ? 'is-selected' : ''}
              data-testid={e2eId('e2e/settings/agent-editors/:editor-id/mode/:mode#button', {
                'editor-id': editorId,
                mode: 'edit'
              })}
              type="button"
              aria-pressed={!sourceMode}
              onClick={() => setSourceMode(false)}
            >
              编辑
            </button>
            <button
              className={sourceMode ? 'is-selected' : ''}
              data-testid={e2eId('e2e/settings/agent-editors/:editor-id/mode/:mode#button', {
                'editor-id': editorId,
                mode: 'source'
              })}
              type="button"
              aria-pressed={sourceMode}
              onClick={() => setSourceMode(true)}
            >
              源码
            </button>
          </div>
          <span className={`save-state-dot is-${saveState}`} aria-live="polite">
            {saveState === 'dirty' ? '未保存' : saveState === 'error' ? '保存失败' : saveLabel}
          </span>
          <button
            className="agent-save-button"
            data-testid={e2eId('e2e/settings/agent-editors/:editor-id/save#button', {
              'editor-id': editorId
            })}
            type="button"
            onClick={onSave}
            disabled={saveState === 'saved' || saveState === 'saving'}
            aria-label={saveLabel}
          >
            {saveState === 'saving' ? <AppIcon name="loader" /> : <AppIcon name="check" />}
            {saveLabel}
          </button>
        </div>
      </header>
      {sourceMode ? (
        <div
          className="agent-monaco-editor"
          data-testid={e2eId('e2e/settings/agent-editors/:editor-id/source#section', {
            'editor-id': editorId
          })}
        >
          <Editor
            language="markdown"
            value={value}
            onChange={(nextValue) => onChange(nextValue ?? '')}
            options={{
              automaticLayout: true,
              ariaLabel: `${ariaLabel} 源码`,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 13,
              lineHeight: 22,
              lineNumbers: 'on',
              minimap: { enabled: false },
              padding: { top: 20, bottom: 24 },
              renderLineHighlight: 'line',
              scrollBeyondLastLine: false,
              wordWrap: 'on'
            }}
            theme="vs"
          />
        </div>
      ) : (
        <MarkdownVisualEditor
          value={value}
          ariaLabel={ariaLabel}
          editorId={editorId}
          onChange={onChange}
        />
      )}
    </section>
  )
}
