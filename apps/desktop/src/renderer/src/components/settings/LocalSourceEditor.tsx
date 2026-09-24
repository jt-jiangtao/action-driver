import Editor from '@monaco-editor/react'
import './local-monaco'

export default function LocalSourceEditor({
  value,
  onChange,
  ariaLabel
}: {
  value: string
  onChange(value: string): void
  ariaLabel: string
}) {
  return (
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
  )
}
