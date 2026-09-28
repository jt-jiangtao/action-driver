import { AppIcon } from '../ui/AppIcon'
import { IconButton } from '../ui/IconButton'
import { useEffect, useState } from 'react'

export function BrowserNavigationBar({ expanded, url, live = false, canGoBack, canGoForward,
  onBack, onForward, onRefresh, onNavigate }: {
  expanded: boolean; url: string; live?: boolean
  canGoBack?: boolean; canGoForward?: boolean
  onBack?(): void; onForward?(): void; onRefresh?(): void; onNavigate?(url: string): void
}) {
  const [draft, setDraft] = useState(url)
  const [error, setError] = useState('')
  useEffect(() => { setDraft(url) }, [url])
  const submit = () => {
    const input = draft.trim()
    if (!input) return
    try {
      const destination = new URL(/^https?:\/\//iu.test(input) ? input : `https://${input}`)
      if (!['http:', 'https:'].includes(destination.protocol) ||
          destination.username || destination.password) throw new Error('invalid')
      setError('')
      onNavigate?.(destination.href)
    } catch { setError('请输入有效的 HTTP(S) 地址') }
  }
  return (
    <div className="browser-navbar">
      <IconButton
        className="browser-plain-button"
        icon="chevron-left"
        aria-label="后退"
        testId="e2e/tasks/detail/browser/back#button"
        disabled={live && !canGoBack}
        onClick={onBack}
      />
      <IconButton
        className="browser-plain-button"
        icon="chevron-right"
        aria-label="前进"
        testId="e2e/tasks/detail/browser/forward#button"
        disabled={live && !canGoForward}
        onClick={onForward}
      />
      <IconButton
        className="browser-plain-button"
        icon="refresh"
        aria-label="刷新"
        testId="e2e/tasks/detail/browser/refresh#button"
        onClick={onRefresh}
      />
      <div className="browser-address">
        {live ? <form onSubmit={(event) => { event.preventDefault(); submit() }}>
          <input aria-label="地址" data-testid="e2e/tasks/detail/browser/address#input" value={draft} onChange={(event) => setDraft(event.target.value)}
            placeholder="搜索或输入网址" spellCheck={false} />
        </form> : <>{expanded ? null : <AppIcon name="lock" />}
          <span>{expanded ? '搜索或输入网址' : url}</span></>}
      </div>
      {error && <span className="browser-address-error" role="alert">{error}</span>}
      {expanded ? (
        <IconButton
          className="browser-plain-button"
          icon="more-vertical"
          aria-label="浏览器菜单"
          testId="e2e/tasks/detail/browser/menu#button"
        />
      ) : null}
    </div>
  )
}
