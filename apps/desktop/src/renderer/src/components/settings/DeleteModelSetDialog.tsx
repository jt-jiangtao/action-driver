import { useRef, useState } from 'react'
import { TextButton } from '../ui/TextButton'

export function DeleteModelSetDialog({
  connectionName,
  onCancel,
  onConfirm
}: {
  connectionName: string
  onCancel(): void
  onConfirm(): Promise<unknown> | void
}) {
  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  return (
    <div className="delete-dialog-backdrop" role="presentation">
      <section
        aria-busy={pending}
        aria-labelledby="delete-model-set-title"
        aria-modal="true"
        className="delete-model-set-dialog"
        role="dialog"
      >
        <h2 id="delete-model-set-title">删除模型集</h2>
        <p>确定删除“{connectionName}”吗？此操作不会删除远端模型。</p>
        <footer>
          <TextButton variant="secondary" disabled={pending} onClick={onCancel}>取消</TextButton>
          <TextButton
            variant="danger"
            state={pending ? 'loading' : 'default'}
            onClick={async () => {
              if (pendingRef.current) return
              pendingRef.current = true
              setPending(true)
              try { await onConfirm() } finally {
                pendingRef.current = false
                setPending(false)
              }
            }}
          >确认删除</TextButton>
        </footer>
      </section>
    </div>
  )
}
