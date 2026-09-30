import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'

type MonacoInstance = {
  editor: { defineTheme(name: string, theme: Record<string, unknown>): void }
}

type EditorComponent = ComponentType<Record<string, unknown>>

const THEME = 'action-driver-light'
const LINE_HEIGHT = 18
const MIN_HEIGHT = 56
const MAX_HEIGHT = 640

let themeDefined = false

/** Matches the in-app token palette so code blocks look like the rest of the UI. */
function defineTheme(instance: MonacoInstance): void {
  if (themeDefined) return
  instance.editor.defineTheme(THEME, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8a8f98' },
      { token: 'string', foreground: '2f7d63' },
      { token: 'number', foreground: '9a5b13' },
      { token: 'keyword', foreground: '5267f7' },
      { token: 'type', foreground: '7a4fd0' },
      { token: 'variable', foreground: '1f2228' }
    ],
    colors: {
      'editor.background': '#f8f8fa',
      // No focus ring, no coloured guides: the block should read as plain code.
      focusBorder: '#00000000',
      'editorWidget.border': '#00000000',
      'editor.foreground': '#1f2228',
      'editorLineNumber.foreground': '#9aa0a8',
      'editorLineNumber.activeForeground': '#5c616b',
      'editor.selectionBackground': '#dfe3ff',
      'editor.inactiveSelectionBackground': '#eceeff',
      'editorOverviewRuler.border': '#00000000',
      'editorGutter.background': '#f8f8fa',
      'scrollbarSlider.background': '#c9ccd280',
      'scrollbarSlider.hoverBackground': '#b3b7bfc0',
      'scrollbarSlider.activeBackground': '#9aa0a8d0'
    }
  })
  themeDefined = true
}

/**
 * Read-only code surface for tool input/output. Uses Monaco so scripts are
 * syntax highlighted and wrapped instead of being shown as one long line, and
 * falls back to a plain block where an editor cannot render (unit tests).
 */
export function ReadOnlyCode({
  value,
  language,
  constrainHeight = true
}: {
  value: string
  language: string
  constrainHeight?: boolean
}) {
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  const heightSubscription = useRef<{ dispose(): void } | null>(null)
  useEffect(
    () => () => {
      heightSubscription.current?.dispose()
    },
    []
  )
  const [Editor, setEditor] = useState<EditorComponent | null>(null)
  const height = useMemo(() => {
    const natural = contentHeight ?? value.split('\n').length * LINE_HEIGHT + 20
    return constrainHeight
      ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, natural))
      : Math.max(MIN_HEIGHT, natural)
  }, [value, contentHeight, constrainHeight])

  useEffect(() => {
    // Monaco cannot render outside a real window; tests and the first paint use
    // the plain block, then the editor replaces it once loaded.
    if (import.meta.env.MODE === 'test') return
    let cancelled = false
    void import('./settings/local-monaco')
      .then(() => import('@monaco-editor/react'))
      .then((module) => {
        if (!cancelled) setEditor(() => module.default as unknown as EditorComponent)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  if (import.meta.env.MODE === 'test' || !Editor) {
    return (
      <pre className={value.length > 900 ? 'is-long' : undefined} data-language={language}>
        {value}
      </pre>
    )
  }

  return (
    <div className={`activity-tool-code${constrainHeight ? '' : ' is-natural'}`} style={{ height }}>
      <Editor
        language={language}
        theme={THEME}
        value={value}
        beforeMount={defineTheme}
        onMount={(editor: {
          getContentHeight(): number
          onDidContentSizeChange(callback: () => void): { dispose(): void }
        }) => {
          heightSubscription.current?.dispose()
          const updateHeight = () => setContentHeight(editor.getContentHeight())
          updateHeight()
          heightSubscription.current = editor.onDidContentSizeChange(updateHeight)
        }}
        loading=""
        options={{
          readOnly: true,
          domReadOnly: true,
          minimap: { enabled: false },
          lineNumbers: 'off',
          glyphMargin: false,
          folding: false,
          lineDecorationsWidth: 8,
          lineNumbersMinChars: 0,
          renderLineHighlight: 'none',
          occurrencesHighlight: 'off',
          selectionHighlight: false,
          bracketPairColorization: { enabled: false },
          guides: { bracketPairs: false, indentation: false },
          renderWhitespace: 'none',
          unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          wrappingIndent: 'same',
          wrappingStrategy: 'simple',
          fontSize: 12.5,
          lineHeight: LINE_HEIGHT,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", "Roboto Mono", monospace',
          fontLigatures: false,
          padding: { top: 10, bottom: 10 },
          contextmenu: true,
          scrollbar: {
            alwaysConsumeMouseWheel: false,
            vertical: constrainHeight ? 'auto' : 'hidden',
            horizontal: 'hidden',
            verticalScrollbarSize: 8
          },
          automaticLayout: true
        }}
      />
    </div>
  )
}

/** Language for a tool id or raw payload; falls back to plain text. */
export function codeLanguage(toolId: string, format: 'text' | 'json' = 'text'): string {
  if (format === 'json') return 'json'
  if (/python/.test(toolId)) return 'python'
  if (/typescript|ts\.run/.test(toolId)) return 'typescript'
  if (/node/.test(toolId)) return 'javascript'
  if (/shell|command/.test(toolId)) return 'shell'
  return 'plaintext'
}
